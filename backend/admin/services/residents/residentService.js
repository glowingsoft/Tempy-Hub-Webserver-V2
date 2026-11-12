const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const { Resident } = require("@models/Resident");
const { Branch } = require("@models/Branch");
const { PeepRecord } = require("@models/PeepRecord");
const { paginateWithFacet, keywordOr, facetCount } = require("@utils/paginate");
const { AppError } = require("@services/_errors/AppError");
const { FamilyVisit } = require("@models/FamilyVisit");
const { Invitation } = require("@models/Invitation");
const { NotificationTypes } = require("@models/Notifications");
const {
  AdmissionStatus,
  CareLevel,
  ResidentDischargeReason,
  FamilyVisitStatus,
  InvitationStatus,
} = require("@models/domainEnums");
const {
  notify,
  familyOf,
  quietly,
} = require("@appServices/family/familyNotify");
const {
  actorStanding,
  assertMayAccessResidents,
  assertBranchInOrganization,
  scopeBranchFilter,
} = require("./residentAccess");

const PASSCODE_PATTERN = /^\d{4,32}$/;
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

/** Photo sharing is a yes or no; anything else is refused rather than guessed. */
const parsePhotographyConsent = (value) => {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new AppError("invalid_photography_consent", 400);
};

const branchSummary = (branch) =>
  branch ? { _id: branch._id, name: branch.name, code: branch.code } : null;

const toPublicResident = (doc, extras = {}) => {
  if (!doc) return doc;
  const { visitorPasscodeHash, ...rest } = doc;
  return {
    ...rest,
    hasVisitorPasscode: Boolean(
      visitorPasscodeHash ||
      doc.visitorPasscodeSetAt ||
      doc.visitorPasscodeRequired,
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
    assertMayAccessResidents(standing, resident.branchId);
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
  if (manage) assertMayAccessResidents(standing, branchId);
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
  admissionStatus,
  keyword,
}) => {
  const standing = await actorStanding(actor, organizationId);
  assertMayAccessResidents(standing, scopeBranchFilter(standing, branchId));

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

  const status = parseAdmissionStatus(admissionStatus);
  const countMatch = { ...match };
  if (status) match.admissionStatus = status;

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
        {
          $match: { ...countMatch, admissionStatus: AdmissionStatus.ADMITTED },
        },
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
  photographyConsent,
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
    photographyConsent:
      photographyConsent === undefined
        ? false
        : parsePhotographyConsent(photographyConsent),
    photographyConsentCheckedAt:
      photographyConsent === undefined ? null : new Date(),
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
  photographyConsent,
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
    if (!String(roomNumber).trim())
      throw new AppError("room_number_required", 400);
    update.roomNumber = String(roomNumber).trim();
  }
  if (careLevel !== undefined) {
    const level = parseCareLevel(careLevel);
    if (!level) throw new AppError("invalid_care_level", 400);
    update.careLevel = level;
  }
  if (photographyConsent !== undefined) {
    update.photographyConsent = parsePhotographyConsent(photographyConsent);
    update.photographyConsentCheckedAt = new Date();
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
    { new: true, runValidators: true },
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
    { new: true, runValidators: true },
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
    withHash.visitorPasscodeHash,
  );
  if (!ok) throw new AppError("resident_passcode_invalid", 403);
  return { ok: true };
};

const FAMILY_ACCESS_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const TABS = ["all", "restricted", "out"];
const OPEN_VISIT_STATUSES = [
  FamilyVisitStatus.REQUESTED,
  FamilyVisitStatus.CONFIRMED,
  FamilyVisitStatus.INVITED,
];
const OPEN_PASS_STATUSES = [
  InvitationStatus.PENDING,
  InvitationStatus.AWAITING_GUEST,
  InvitationStatus.ACCEPTED,
];

const toId = (value) => new mongoose.Types.ObjectId(String(value));

const parseTab = (value) => {
  if (value == null || value === "") return "all";
  const tab = String(value).trim().toLowerCase();
  if (!TABS.includes(tab)) throw new AppError("invalid_resident_tab", 400);
  return tab;
};

const parseAdmission = (value) => {
  if (value == null || value === "") return AdmissionStatus.ADMITTED;
  const status = String(value).trim().toLowerCase();
  if (!Object.values(AdmissionStatus).includes(status)) {
    throw new AppError("invalid_admission_status", 400);
  }
  return status;
};

const parseFlag = (value, key) => {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new AppError(key, 400);
};

const parseDate = (value, key) => {
  if (value == null || value === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new AppError(key, 400);
  return date;
};

const parseDischargeReason = (value) => {
  const reason = String(value ?? "").trim();
  if (!Object.values(ResidentDischargeReason).includes(reason)) {
    throw new AppError("invalid_discharge_reason", 400);
  }
  return reason;
};

const toPeep = (record) => ({
  recorded: Boolean(record),
  level: record?.peepLevel || null,
  mobility: record?.mobilityNotes || "",
  equipment: record?.equipmentRequired || "",
  assistance: record?.assistanceRequired || "",
});

const loadPeepByResident = async (residents) => {
  const records = await PeepRecord.find({
    residentId: { $in: residents.map((resident) => resident._id) },
  })
    .select("residentId peepLevel mobilityNotes equipmentRequired assistanceRequired")
    .lean();
  return new Map(records.map((record) => [String(record.residentId), record]));
};

const toRow = (resident, peepRecord = null) => {
  const row = {
    _id: resident._id,
    name: resident.name,
    roomNumber: resident.roomNumber || "",
    photoUrl: resident.photoUrl || "",
    careLevel: resident.careLevel || null,
    admissionStatus: resident.admissionStatus,
    branchId: resident.branchId,
    peep: toPeep(peepRecord),
    restriction: {
      active: Boolean(resident.restricted),
      reason: resident.restrictedReason || "",
      since: resident.restrictedAt || null,
    },
    out: {
      active: Boolean(resident.isOut),
      destination: resident.outDestination || "",
      note: resident.outNote || "",
      since: resident.outSince || null,
      expectedReturnAt: resident.expectedReturnAt || null,
    },
  };
  const discharge = resident.discharge;
  if (
    resident.admissionStatus === AdmissionStatus.DISCHARGED &&
    discharge?.reason
  ) {
    row.discharge = {
      reason: discharge.reason,
      message: discharge.message || "",
      dischargedAt: discharge.dischargedAt,
      familyAccessEndsAt: discharge.familyAccessEndsAt,
      familiesNotified: discharge.familiesNotified || 0,
      visitsCancelled: discharge.visitsCancelled || 0,
      visitPassesCancelled: discharge.visitPassesCancelled || 0,
    };
  }
  return row;
};

const loadResident = async (residentId, organizationId) => {
  const [resident] = await Resident.aggregate([
    { $match: { _id: toId(residentId), organizationId: toId(organizationId) } },
  ]);
  return resident || null;
};

const requireManagedResident = async ({
  actor,
  organizationId,
  residentId,
}) => {
  const resident = await loadResident(residentId, organizationId);
  if (!resident) throw new AppError("resident_not_found", 404);
  const standing = await actorStanding(actor, organizationId);
  assertMayAccessResidents(standing, resident.branchId);
  return resident;
};

const requireAdmitted = (resident) => {
  if (resident.admissionStatus !== AdmissionStatus.ADMITTED) {
    throw new AppError("resident_not_admitted", 409);
  }
};

const readRow = async (resident) => {
  const fresh = await loadResident(resident._id, resident.organizationId);
  const peep = await loadPeepByResident([fresh]);
  return toRow(fresh, peep.get(String(fresh._id)));
};

const updateAndRead = async (resident, set) => {
  await Resident.updateOne({ _id: resident._id }, { $set: set });
  return readRow(resident);
};

const listManagerResidents = async ({
  actor,
  organizationId,
  branchId,
  tab,
  admissionStatus,
  keyword,
  page,
  limit,
  skip,
}) => {
  const standing = await actorStanding(actor, organizationId);
  const scopedBranchId = scopeBranchFilter(standing, branchId);
  assertMayAccessResidents(standing, scopedBranchId);
  if (scopedBranchId) {
    await assertBranchInOrganization(scopedBranchId, organizationId);
  }

  const activeTab = parseTab(tab);
  const countMatch = {
    organizationId: toId(organizationId),
    admissionStatus: parseAdmission(admissionStatus),
  };
  if (scopedBranchId) countMatch.branchId = toId(scopedBranchId);
  const or = keywordOr(keyword, ["name", "roomNumber"], { trim: true });
  if (or) countMatch.$or = or;

  const match = { ...countMatch };
  if (activeTab === "restricted") match.restricted = true;
  if (activeTab === "out") match.isOut = true;

  const { data, meta, result } = await paginateWithFacet({
    model: Resident,
    match,
    page,
    limit,
    skip,
    sort: { name: 1 },
    extraFacets: {
      allCount: [{ $match: countMatch }, { $count: "count" }],
      restrictedCount: [
        { $match: { ...countMatch, restricted: true } },
        { $count: "count" },
      ],
      outCount: [
        { $match: { ...countMatch, isOut: true } },
        { $count: "count" },
      ],
    },
  });

  const peepByResident = await loadPeepByResident(data);

  return {
    data: data.map((row) => toRow(row, peepByResident.get(String(row._id)))),
    meta: {
      ...meta,
      tabCounts: {
        all: facetCount(result.allCount),
        restricted: facetCount(result.restrictedCount),
        out: facetCount(result.outCount),
      },
    },
  };
};

const getManagerResident = async ({ actor, organizationId, residentId }) => {
  const resident = await requireManagedResident({
    actor,
    organizationId,
    residentId,
  });
  const peep = await loadPeepByResident([resident]);
  return toRow(resident, peep.get(String(resident._id)));
};

const setRestriction = async ({
  actor,
  organizationId,
  residentId,
  restricted,
  reason,
}) => {
  const resident = await requireManagedResident({
    actor,
    organizationId,
    residentId,
  });
  requireAdmitted(resident);
  const on = parseFlag(restricted, "invalid_restricted_flag");

  return updateAndRead(
    resident,
    on
      ? {
          restricted: true,
          restrictedReason: reason ? String(reason).trim() : "",
          restrictedAt: new Date(),
          restrictedByUserId: actor._id,
        }
      : {
          restricted: false,
          restrictedReason: "",
          restrictedAt: null,
          restrictedByUserId: null,
        },
  );
};

const setOut = async ({
  actor,
  organizationId,
  residentId,
  out,
  destination,
  note,
  expectedReturnAt,
}) => {
  const resident = await requireManagedResident({
    actor,
    organizationId,
    residentId,
  });
  requireAdmitted(resident);
  const on = parseFlag(out, "invalid_out_flag");

  return updateAndRead(
    resident,
    on
      ? {
          isOut: true,
          outDestination: destination ? String(destination).trim() : "",
          outNote: note ? String(note).trim() : "",
          outSince: new Date(),
          expectedReturnAt: parseDate(
            expectedReturnAt,
            "invalid_expected_return",
          ),
          outByUserId: actor._id,
        }
      : {
          isOut: false,
          outDestination: "",
          outNote: "",
          outSince: null,
          expectedReturnAt: null,
          outByUserId: null,
        },
  );
};

const deactivateResident = async ({
  actor,
  organizationId,
  residentId,
  reason,
  message,
}) => {
  const resident = await requireManagedResident({
    actor,
    organizationId,
    residentId,
  });
  const dischargeReason = parseDischargeReason(reason);
  const personalMessage = message ? String(message).trim() : "";

  const now = new Date();
  const receivers = personalMessage
    ? await familyOf({ organizationId, residentId: resident._id })
    : [];

  const moved = await Resident.updateOne(
    { _id: resident._id, admissionStatus: AdmissionStatus.ADMITTED },
    {
      $set: {
        admissionStatus: AdmissionStatus.DISCHARGED,
        isOut: false,
        outDestination: "",
        outNote: "",
        outSince: null,
        expectedReturnAt: null,
        outByUserId: null,
        discharge: {
          reason: dischargeReason,
          message: personalMessage,
          dischargedAt: now,
          dischargedByUserId: actor._id,
          familyAccessEndsAt: new Date(
            now.getTime() + FAMILY_ACCESS_DAYS * DAY_MS,
          ),
          familiesNotified: receivers.length,
          visitsCancelled: 0,
          visitPassesCancelled: 0,
        },
      },
    },
  );
  if (moved.modifiedCount !== 1) {
    throw new AppError("resident_not_admitted", 409);
  }

  const cancelled = await FamilyVisit.updateMany(
    {
      residentId: resident._id,
      status: { $in: OPEN_VISIT_STATUSES },
      startAt: { $gte: now },
    },
    { $set: { status: FamilyVisitStatus.CANCELLED } },
  );
  const passes = await Invitation.updateMany(
    {
      residentId: resident._id,
      status: { $in: OPEN_PASS_STATUSES },
    },
    { $set: { status: InvitationStatus.CANCELLED } },
  );

  if (receivers.length) {
    await quietly(() =>
      notify({
        receivers,
        type: NotificationTypes.FAMILY_ACCESS,
        subjectId: actor._id,
        objectId: resident._id,
        objectType: "resident",
        title: `Update about ${resident.name}`,
        body: personalMessage,
      }),
    );
  }

  return updateAndRead(resident, {
    "discharge.visitsCancelled": cancelled.modifiedCount || 0,
    "discharge.visitPassesCancelled": passes.modifiedCount || 0,
    "discharge.familiesNotified": receivers.length,
  });
};

module.exports = {
  listResidents,
  getResident,
  listManagerResidents,
  getManagerResident,
  setRestriction,
  setOut,
  deactivateResident,
  createResident,
  updateResident,
  setVisitorPasscode,
  verifyVisitorPasscode,
};
