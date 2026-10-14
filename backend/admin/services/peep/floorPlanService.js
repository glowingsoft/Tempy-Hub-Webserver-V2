const mongoose = require("mongoose");
const { FloorPlan } = require("@models/FloorPlan");
const { FloorPlanPin } = require("@models/FloorPlanPin");
const { Resident } = require("@models/Resident");
const { Branch } = require("@models/Branch");
const { paginateWithFacet, keywordOr, facetCount } = require("@utils/paginate");
const { AppError } = require("@services/_errors/AppError");
const { AdmissionStatus, MembershipRole } = require("@models/domainEnums");
const {
  actorStanding,
  assertMayManageStaff,
  assertBranchInOrganization,
  scopeBranchFilter,
  duplicateKey,
} = require("./floorPlanAccess");

const PLAN_STATUSES = ["uploaded", "notUploaded"];

const toOid = (value) => {
  if (!value || !mongoose.Types.ObjectId.isValid(String(value))) {
    throw new AppError("invalid_id", 400);
  }
  return new mongoose.Types.ObjectId(String(value));
};

const hasImageUrl = (url) => Boolean(url && String(url).trim());

const parsePlanStatus = (status) => {
  if (status == null || status === "" || status === "all") return null;
  if (!PLAN_STATUSES.includes(status)) {
    throw new AppError("invalid_floor_plan_status", 400);
  }
  return status;
};

const parsePinCoord = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    throw new AppError("invalid_floor_plan_pin", 400);
  }
  return n;
};

const emptyImageMatch = {
  $or: [{ imageUrl: "" }, { imageUrl: null }, { imageUrl: { $exists: false } }],
};

const withImageMatch = { imageUrl: { $nin: ["", null] } };

const andMatch = (base, extra) => {
  const clauses = [base, extra].filter(
    (clause) => clause && Object.keys(clause).length
  );
  if (clauses.length <= 1) return clauses[0] || {};
  return { $and: clauses };
};

const floorPlanStatusCountFacets = (countMatch) => ({
  uploadedCount: [
    { $match: andMatch(countMatch, withImageMatch) },
    { $count: "count" },
  ],
  notUploadedCount: [
    { $match: andMatch(countMatch, emptyImageMatch) },
    { $count: "count" },
  ],
});

const pinResidentLookup = [
  {
    $lookup: {
      from: Resident.collection.name,
      localField: "residentId",
      foreignField: "_id",
      as: "_resident",
      pipeline: [{ $project: { name: 1, roomNumber: 1, photoUrl: 1 } }],
    },
  },
  {
    $addFields: {
      resident: { $arrayElemAt: ["$_resident", 0] },
    },
  },
  { $project: { _resident: 0 } },
];

const planEnrichStages = (withPins) => [
  {
    $lookup: {
      from: FloorPlanPin.collection.name,
      localField: "_id",
      foreignField: "floorPlanId",
      as: withPins ? "pins" : "_pins",
      pipeline: withPins
        ? [{ $sort: { createdAt: 1 } }, ...pinResidentLookup]
        : [{ $project: { _id: 1 } }],
    },
  },
  {
    $lookup: {
      from: Branch.collection.name,
      localField: "branchId",
      foreignField: "_id",
      as: "_branch",
      pipeline: [{ $project: { name: 1, code: 1 } }],
    },
  },
  {
    $addFields: {
      pinsCount: { $size: withPins ? "$pins" : "$_pins" },
      status: {
        $cond: [
          { $gt: [{ $strLenCP: { $ifNull: ["$imageUrl", ""] } }, 0] },
          "uploaded",
          "notUploaded",
        ],
      },
      branch: {
        $let: {
          vars: { b: { $arrayElemAt: ["$_branch", 0] } },
          in: {
            _id: "$$b._id",
            name: "$$b.name",
            code: "$$b.code",
          },
        },
      },
    },
  },
  { $project: { _pins: 0, _branch: 0 } },
];

const loadShapedPlan = async (
  floorPlanId,
  organizationId,
  { withPins = false } = {}
) => {
  const [row] = await FloorPlan.aggregate([
    {
      $match: {
        _id: toOid(floorPlanId),
        organizationId: toOid(organizationId),
      },
    },
    ...planEnrichStages(withPins),
  ]);
  if (!row) throw new AppError("floor_plan_not_found", 404);
  return row;
};

const loadPlanForWrite = async (floorPlanId, organizationId, { residentId } = {}) => {
  const pipeline = [
    {
      $match: {
        _id: toOid(floorPlanId),
        organizationId: toOid(organizationId),
      },
    },
  ];

  if (residentId) {
    pipeline.push({
      $lookup: {
        from: Resident.collection.name,
        let: { siteId: "$branchId", orgId: "$organizationId" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$_id", toOid(residentId)] },
                  { $eq: ["$branchId", "$$siteId"] },
                  { $eq: ["$organizationId", "$$orgId"] },
                  { $eq: ["$admissionStatus", AdmissionStatus.ADMITTED] },
                ],
              },
            },
          },
          { $project: { _id: 1 } },
          { $limit: 1 },
        ],
        as: "_resident",
      },
    });
  }

  const [plan] = await FloorPlan.aggregate(pipeline);
  if (!plan) throw new AppError("floor_plan_not_found", 404);
  return plan;
};

const assertMayAccessPlan = async (actor, organizationId, branchId, { manage }) => {
  const standing = await actorStanding(actor, organizationId);
  if (manage) {
    assertMayManageStaff(standing, branchId);
  } else if (
    standing.role === MembershipRole.SITE_MANAGER &&
    String(standing.branchId) !== String(branchId)
  ) {
    throw new AppError("outside_managed_branch", 403);
  }
  await assertBranchInOrganization(branchId, organizationId);
  return standing;
};

const listFloorPlans = async ({
  actor,
  organizationId,
  page,
  limit,
  skip,
  branchId,
  keyword,
  status,
}) => {
  const standing = await actorStanding(actor, organizationId);
  const scoped = scopeBranchFilter(standing, branchId);
  const match = {
    organizationId: toOid(organizationId),
  };
  if (scoped) match.branchId = toOid(scoped);
  else if (branchId) match.branchId = toOid(branchId);

  const or = keywordOr(keyword, ["name"], { trim: true });
  if (or) match.$or = or;

  const countMatch = { ...match };
  const tab = parsePlanStatus(status);
  let listMatch = match;
  if (tab === "uploaded") listMatch = andMatch(match, withImageMatch);
  if (tab === "notUploaded") listMatch = andMatch(match, emptyImageMatch);

  const { data, meta, result } = await paginateWithFacet({
    model: FloorPlan,
    match: listMatch,
    page,
    limit,
    skip,
    sort: { name: 1 },
    extraDataStages: planEnrichStages(false),
    extraFacets: floorPlanStatusCountFacets(countMatch),
  });

  return {
    data,
    meta: {
      ...meta,
      counts: {
        uploaded: facetCount(result.uploadedCount),
        notUploaded: facetCount(result.notUploadedCount),
      },
    },
  };
};

const createFloorPlan = async ({
  actor,
  organizationId,
  branchId,
  name,
  imageUrl,
  pdfUrl,
  meta,
}) => {
  if (!name || !String(name).trim()) throw new AppError("floor_plan_name_required", 400);
  const standing = await actorStanding(actor, organizationId);
  const scoped = scopeBranchFilter(standing, branchId) || branchId;
  if (!scoped) throw new AppError("branch_scope_required", 400);
  assertMayManageStaff(standing, scoped);
  await assertBranchInOrganization(scoped, organizationId);

  const image = imageUrl != null ? String(imageUrl).trim() : "";
  try {
    const plan = await FloorPlan.create({
      organizationId,
      branchId: scoped,
      name: String(name).trim(),
      imageUrl: image,
      pdfUrl: pdfUrl != null ? String(pdfUrl).trim() : "",
      version: hasImageUrl(image) ? 1 : 0,
      meta: meta ?? null,
    });
    return loadShapedPlan(plan._id, organizationId);
  } catch (error) {
    if (duplicateKey(error)) throw new AppError("floor_plan_name_taken", 409);
    throw error;
  }
};

const getFloorPlan = async ({ actor, organizationId, floorPlanId }) => {
  const plan = await loadShapedPlan(floorPlanId, organizationId, {
    withPins: true,
  });
  await assertMayAccessPlan(actor, organizationId, plan.branchId, {
    manage: false,
  });
  return plan;
};

const updateFloorPlan = async ({
  actor,
  organizationId,
  floorPlanId,
  name,
  imageUrl,
  pdfUrl,
  meta,
}) => {
  const plan = await loadPlanForWrite(floorPlanId, organizationId);
  await assertMayAccessPlan(actor, organizationId, plan.branchId, {
    manage: true,
  });

  const updates = {};
  if (name !== undefined) updates.name = String(name).trim();
  if (imageUrl !== undefined) updates.imageUrl = String(imageUrl).trim();
  if (pdfUrl !== undefined) updates.pdfUrl = String(pdfUrl).trim();
  if (meta !== undefined) updates.meta = meta;

  if (!Object.keys(updates).length) throw new AppError("nothing_to_update", 400);

  const imageChanged =
    updates.imageUrl !== undefined &&
    String(updates.imageUrl) !== String(plan.imageUrl);
  if (imageChanged && hasImageUrl(updates.imageUrl)) {
    updates.version = (plan.version || 0) + 1;
    await FloorPlanPin.deleteMany({ floorPlanId: plan._id });
  }

  try {
    await FloorPlan.findByIdAndUpdate(plan._id, { $set: updates });
  } catch (error) {
    if (duplicateKey(error)) throw new AppError("floor_plan_name_taken", 409);
    throw error;
  }

  return loadShapedPlan(plan._id, organizationId, { withPins: true });
};

const upsertFloorPlanPin = async ({
  actor,
  organizationId,
  floorPlanId,
  residentId,
  x,
  y,
}) => {
  const plan = await loadPlanForWrite(floorPlanId, organizationId, {
    residentId,
  });
  await assertMayAccessPlan(actor, organizationId, plan.branchId, {
    manage: true,
  });
  if (!hasImageUrl(plan.imageUrl)) {
    throw new AppError("floor_plan_image_required", 400);
  }
  if (!plan._resident?.length) throw new AppError("resident_not_found", 404);

  const pin = await FloorPlanPin.findOneAndUpdate(
    { floorPlanId: plan._id, residentId: plan._resident[0]._id },
    {
      $set: {
        organizationId: plan.organizationId,
        branchId: plan.branchId,
        x: parsePinCoord(x),
        y: parsePinCoord(y),
      },
    },
    { new: true, upsert: true }
  ).lean();

  const [row] = await FloorPlanPin.aggregate([
    { $match: { _id: pin._id } },
    ...pinResidentLookup,
  ]);
  return row || pin;
};

const deleteFloorPlanPin = async ({
  actor,
  organizationId,
  floorPlanId,
  pinId,
}) => {
  const plan = await loadPlanForWrite(floorPlanId, organizationId);
  await assertMayAccessPlan(actor, organizationId, plan.branchId, {
    manage: true,
  });
  const pin = await FloorPlanPin.findOneAndDelete({
    _id: toOid(pinId),
    floorPlanId: plan._id,
  }).lean();
  if (!pin) throw new AppError("floor_plan_pin_not_found", 404);
  return pin;
};

module.exports = {
  listFloorPlans,
  createFloorPlan,
  getFloorPlan,
  updateFloorPlan,
  upsertFloorPlanPin,
  deleteFloorPlanPin,
};
