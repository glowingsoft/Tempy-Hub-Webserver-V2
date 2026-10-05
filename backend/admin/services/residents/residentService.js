const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const { Resident } = require("@models/Resident");
const { Branch } = require("@models/Branch");
const { PeepRecord } = require("@models/PeepRecord");
const { paginateWithFacet, keywordOr, facetCount } = require("@utils/paginate");
const { AppError } = require("@services/_errors/AppError");
const { AdmissionStatus, CareLevel } = require("@models/domainEnums");
const {
  actorStanding,
  assertMayManageStaff,
  assertBranchInOrganization,
  scopeBranchFilter,
} = require("@adminServices/staff/staffAccess");

const PASSCODE_PATTERN = /^[A-Za-z0-9-]{4,32}$/;
const QR_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const STATUS_ALIASES = {
  active: AdmissionStatus.ADMITTED,
  inactive: AdmissionStatus.DISCHARGED,
  [AdmissionStatus.ADMITTED]: AdmissionStatus.ADMITTED,
  [AdmissionStatus.DISCHARGED]: AdmissionStatus.DISCHARGED,
};

const parseAdmissionStatus = (value) => {
  if (value == null || value === "") return undefined;
  const status = STATUS_ALIASES[String(value).trim().toLowerCase()];
  if (!status) throw new AppError("invalid_admission_status", 400);
  return status;
};

const parseCareLevel = (value) => {
  if (value == null || value === "") return undefined;
  const level = String(value).trim().toLowerCase();
  if (!Object.values(CareLevel).includes(level)) {
    throw new AppError("invalid_care_level", 400);
  }
  return level;
};

const assertPasscodeShape = (value) => {
  const passcode = String(value).trim();
  if (!PASSCODE_PATTERN.test(passcode)) {
    throw new AppError("invalid_resident_passcode", 400);
  }
  return passcode;
};

const hashPasscode = (value) => bcrypt.hash(assertPasscodeShape(value), 10);

const generateQrToken = async () => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const token = Array.from(crypto.randomBytes(10))
      .map((byte) => QR_ALPHABET[byte % QR_ALPHABET.length])
      .join("");
    const exists = await Resident.exists({ qrToken: token });
    if (!exists) return token;
  }
  throw new AppError("resident_qr_generation_failed", 500);
};

const branchSummary = (branch) =>
  branch
    ? { _id: branch._id, name: branch.name, code: branch.code }
    : null;

const toPublicResident = (doc, extras = {}) => {
  if (!doc) return doc;
  const { visitorPasscodeHash, ...rest } = doc;
  return {
    ...rest,
    hasVisitorPasscode: Boolean(
      visitorPasscodeHash || doc.visitorPasscodeSetAt || doc.visitorPasscodeRequired
    ),
    ...extras,
  };
};

const requireResidentInOrg = async ({
  actor,
  organizationId,
  residentId,
  manage = false,
}) => {
  const resident = await Resident.findOne({
    _id: residentId,
    organizationId,
  }).lean();
  if (!resident) throw new AppError("resident_not_found", 404);

  const standing = await actorStanding(actor, organizationId);
  if (manage) {
    assertMayManageStaff(standing, resident.branchId);
  } else {
    const scoped = scopeBranchFilter(standing, resident.branchId);
    if (scoped && String(scoped) !== String(resident.branchId)) {
      throw new AppError("outside_managed_branch", 403);
    }
  }
  return { resident, standing };
};

const loadBranch = async ({ actor, organizationId, branchId, manage }) => {
  if (!branchId) throw new AppError("branch_required", 400);
  await assertBranchInOrganization(branchId, organizationId);
  const standing = await actorStanding(actor, organizationId);
  if (manage) assertMayManageStaff(standing, branchId);
  const branch = await Branch.findOne({ _id: branchId, organizationId })
    .select("_id name code organizationId")
    .lean();
  if (!branch) throw new AppError("branch_not_found", 404);
  return { branch, standing };
};

const attachPeep = async (resident) => {
  const peep = await PeepRecord.findOne({ residentId: resident._id })
    .select("_id reviewDueAt consentStatus")
    .lean();
  return toPublicResident(resident, {
    peep: peep
      ? {
          _id: peep._id,
          reviewDueAt: peep.reviewDueAt,
          consentStatus: peep.consentStatus,
        }
      : null,
  });
};

const listResidents = async ({
  actor,
  organizationId,
  page,
  limit,
  skip,
  branchId,
  status,
  keyword,
}) => {
  const standing = await actorStanding(actor, organizationId);
  assertMayManageStaff(standing, scopeBranchFilter(standing, branchId));

  const scopedBranchId = scopeBranchFilter(standing, branchId);
  if (scopedBranchId) {
    await assertBranchInOrganization(scopedBranchId, organizationId);
  }

  const match = {
    organizationId: new mongoose.Types.ObjectId(String(organizationId)),
  };
  if (scopedBranchId) {
    match.branchId = new mongoose.Types.ObjectId(String(scopedBranchId));
  }

  const admissionStatus = parseAdmissionStatus(status);
  const countMatch = { ...match };
  if (admissionStatus) match.admissionStatus = admissionStatus;

  const or = keywordOr(keyword, ["name", "email", "roomNumber", "phone"], {
    trim: true,
  });
  if (or) {
    match.$or = or;
    countMatch.$or = or;
  }

  const branchLookup = [
    {
      $lookup: {
        from: Branch.collection.name,
        localField: "branchId",
        foreignField: "_id",
        as: "_branch",
      },
    },
    {
      $addFields: {
        hasVisitorPasscode: {
          $gt: [{ $strLenCP: { $ifNull: ["$visitorPasscodeHash", ""] } }, 0],
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
    { $project: { visitorPasscodeHash: 0, _branch: 0 } },
  ];

  const { data, meta, result } = await paginateWithFacet({
    model: Resident,
    match,
    page,
    limit,
    skip,
    extraDataStages: branchLookup,
    extraFacets: {
      admittedCount: [
        { $match: { ...countMatch, admissionStatus: AdmissionStatus.ADMITTED } },
        { $count: "count" },
      ],
      dischargedCount: [
        {
          $match: {
            ...countMatch,
            admissionStatus: AdmissionStatus.DISCHARGED,
          },
        },
        { $count: "count" },
      ],
    },
  });

  return {
    data,
    meta: {
      ...meta,
      admitted: facetCount(result.admittedCount),
      discharged: facetCount(result.dischargedCount),
    },
  };
};

const getResident = async ({ actor, organizationId, residentId }) => {
  const { resident } = await requireResidentInOrg({
    actor,
    organizationId,
    residentId,
  });
  const branch = await Branch.findById(resident.branchId)
    .select("_id name code")
    .lean();
  const withPeep = await attachPeep(resident);
  return { ...withPeep, branch: branchSummary(branch) };
};

const applyPasscodeFields = async (payload, visitorPasscode) => {
  if (visitorPasscode === undefined) return payload;
  if (visitorPasscode === null || String(visitorPasscode).trim() === "") {
    payload.visitorPasscodeRequired = false;
    payload.visitorPasscodeHash = null;
    payload.visitorPasscodeSetAt = null;
    return payload;
  }
  payload.visitorPasscodeHash = await hashPasscode(visitorPasscode);
  payload.visitorPasscodeRequired = true;
  payload.visitorPasscodeSetAt = new Date();
  return payload;
};

const createResident = async ({
  actor,
  organizationId,
  branchId,
  name,
  email,
  phone,
  photoUrl,
  roomNumber,
  careLevel,
  admissionStatus,
  visitorPasscode,
}) => {
  const { branch } = await loadBranch({
    actor,
    organizationId,
    branchId,
    manage: true,
  });

  if (!name || !String(name).trim()) throw new AppError("name_required", 400);
  if (!roomNumber || !String(roomNumber).trim()) {
    throw new AppError("room_number_required", 400);
  }

  const status =
    parseAdmissionStatus(admissionStatus) || AdmissionStatus.ADMITTED;

  const payload = {
    organizationId: branch.organizationId,
    branchId: branch._id,
    name: String(name).trim(),
    email: email ? String(email).trim().toLowerCase() : "",
    phone: phone ? String(phone).trim() : "",
    photoUrl: photoUrl || "",
    roomNumber: String(roomNumber).trim(),
    admissionStatus: status,
    admittedAt: status === AdmissionStatus.ADMITTED ? new Date() : null,
    qrToken: await generateQrToken(),
  };

  const level = parseCareLevel(careLevel);
  if (level) payload.careLevel = level;

  await applyPasscodeFields(payload, visitorPasscode);

  const resident = await Resident.create(payload);
  return toPublicResident(resident.toObject(), {
    peep: null,
    branch: branchSummary(branch),
  });
};

const updateResident = async ({
  actor,
  organizationId,
  residentId,
  name,
  email,
  phone,
  photoUrl,
  roomNumber,
  careLevel,
  admissionStatus,
  branchId,
}) => {
  const { resident } = await requireResidentInOrg({
    actor,
    organizationId,
    residentId,
    manage: true,
  });

  const update = {};
  if (name !== undefined) {
    if (!String(name).trim()) throw new AppError("name_required", 400);
    update.name = String(name).trim();
  }
  if (email !== undefined) update.email = String(email).trim().toLowerCase();
  if (phone !== undefined) update.phone = String(phone).trim();
  if (photoUrl !== undefined) update.photoUrl = photoUrl || "";
  if (roomNumber !== undefined) {
    if (!String(roomNumber).trim()) throw new AppError("room_number_required", 400);
    update.roomNumber = String(roomNumber).trim();
  }
  if (careLevel !== undefined) {
    const level = parseCareLevel(careLevel);
    if (!level) throw new AppError("invalid_care_level", 400);
    update.careLevel = level;
  }
  if (admissionStatus !== undefined) {
    update.admissionStatus = parseAdmissionStatus(admissionStatus);
    if (
      update.admissionStatus === AdmissionStatus.ADMITTED &&
      resident.admissionStatus !== AdmissionStatus.ADMITTED
    ) {
      update.admittedAt = new Date();
    }
  }
  if (branchId !== undefined) {
    const { branch } = await loadBranch({
      actor,
      organizationId,
      branchId,
      manage: true,
    });
    update.branchId = branch._id;
  }

  if (!Object.keys(update).length) throw new AppError("nothing_to_update", 400);

  const saved = await Resident.findOneAndUpdate(
    { _id: residentId, organizationId },
    { $set: update },
    { new: true, runValidators: true }
  ).lean();
  if (!saved) throw new AppError("resident_not_found", 404);

  const branch = await Branch.findById(saved.branchId)
    .select("_id name code")
    .lean();
  const withPeep = await attachPeep(saved);
  return { ...withPeep, branch: branchSummary(branch) };
};

const setVisitorPasscode = async ({
  actor,
  organizationId,
  residentId,
  visitorPasscode,
}) => {
  await requireResidentInOrg({
    actor,
    organizationId,
    residentId,
    manage: true,
  });

  if (visitorPasscode === undefined) {
    throw new AppError("resident_passcode_required", 400);
  }

  const fields = await applyPasscodeFields({}, visitorPasscode);
  const saved = await Resident.findOneAndUpdate(
    { _id: residentId, organizationId },
    { $set: fields },
    { new: true, runValidators: true }
  ).lean();
  if (!saved) throw new AppError("resident_not_found", 404);

  return toPublicResident(saved);
};

const verifyVisitorPasscode = async ({
  actor,
  organizationId,
  residentId,
  visitorPasscode,
}) => {
  const { resident } = await requireResidentInOrg({
    actor,
    organizationId,
    residentId,
  });

  const withHash = await Resident.findById(resident._id)
    .select("+visitorPasscodeHash visitorPasscodeRequired")
    .lean();

  if (!withHash?.visitorPasscodeRequired || !withHash.visitorPasscodeHash) {
    throw new AppError("resident_passcode_not_set", 400);
  }
  if (!visitorPasscode) throw new AppError("resident_passcode_required", 400);

  const ok = await bcrypt.compare(
    String(visitorPasscode).trim(),
    withHash.visitorPasscodeHash
  );
  if (!ok) throw new AppError("resident_passcode_invalid", 403);
  return { ok: true };
};

module.exports = {
  listResidents,
  getResident,
  createResident,
  updateResident,
  setVisitorPasscode,
  verifyVisitorPasscode,
};
