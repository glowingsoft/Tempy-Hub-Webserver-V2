const mongoose = require("mongoose");
const { Organization } = require("@models/Organization");
const { StaffProfile } = require("@models/StaffProfile");
const { Branch } = require("@models/Branch");
const { SupervisionRecord } = require("@models/SupervisionRecord");
const { AppraisalRecord } = require("@models/AppraisalRecord");
const { Requirement } = require("@models/Requirement");
const { RequirementAssignment } = require("@models/RequirementAssignment");
const { RequirementRecord } = require("@models/RequirementRecord");
const { EvacuationEvent } = require("@models/EvacuationEvent");
const { EvacCheck } = require("@models/EvacCheck");
const { AppError } = require("@services/_errors/AppError");
const {
  StaffProfileStatus,
  ComplianceMeetingStatus,
  AppraisalKind,
  RequirementType,
  EvacPersonKind,
  EvacCheckStatus,
  EvacuationType,
} = require("@models/domainEnums");
const {
  DEFAULT_TZ,
  supervisionStanding,
} = require("../supervision/supervisionSchedule");
const { effectiveIntervals } = require("../appraisal/cycle");
const { cellFromDates } = require("../requirements/requirementDates");

const toOid = (value, key) => {
  if (!mongoose.Types.ObjectId.isValid(value)) throw new AppError(key, 400);
  return new mongoose.Types.ObjectId(String(value));
};

const meetingScore = (standing) => ({
  percent: standing.score,
  badge: standing.badge,
  completed: standing.completed,
  expected: standing.required,
  nextDueAt: standing.nextDueAt,
});

const emptyRequirementScore = () => ({
  percent: null,
  done: 0,
  expected: 0,
});

const scoreAssignments = (rows, type, amberDays) => {
  const cells = rows
    .filter((row) => row.requirement?.type === type)
    .map((row) =>
      cellFromDates({
        assignment: row,
        latest: row.latest?.[0] || null,
        requirement: row.requirement,
        orgAmberDays: amberDays,
      })
    );
  const expected = cells.filter((cell) => cell.expected).length;
  const done = cells.filter((cell) => cell.met).length;
  return {
    percent:
      expected === 0 ? null : Math.min(100, Math.round((done / expected) * 100)),
    done,
    expected,
  };
};

/** Mock drills at this site where this staff is on the roll. Safe / those drills. */
const fireDrillScore = async ({ staffId, branchId }) => {
  if (!branchId) return { percent: null, done: 0, expected: 0 };

  const events = await EvacuationEvent.find({
    branchId,
    type: EvacuationType.MOCK,
  })
    .select("_id")
    .lean();
  if (!events.length) return { percent: null, done: 0, expected: 0 };

  const eventIds = events.map((row) => row._id);
  const checks = await EvacCheck.find({
    evacuationEventId: { $in: eventIds },
    personKind: EvacPersonKind.STAFF,
    personId: staffId,
  })
    .select("status")
    .lean();

  const expected = checks.length;
  if (!expected) return { percent: null, done: 0, expected: 0 };

  const done = checks.filter((row) => row.status === EvacCheckStatus.SAFE)
    .length;
  return {
    percent: Math.min(100, Math.round((done / expected) * 100)),
    done,
    expected,
  };
};

const loadStaff = async (actor, organizationId) => {
  const staff = await StaffProfile.findOne({
    userId: actor._id,
    organizationId,
    status: StaffProfileStatus.ACTIVE,
  })
    .select("_id startDate branchId supervisionIntervalMonths appraisalIntervalMonths")
    .lean();
  if (!staff) throw new AppError("staff_profile_not_found", 404);
  return staff;
};

const meetingsOf = (model, organizationId, staffId) =>
  model
    .find({
      organizationId,
      staffId,
      status: { $ne: ComplianceMeetingStatus.CANCELLED },
    })
    .select("status completedAt scheduledAt kind")
    .sort({ completedAt: -1, scheduledAt: -1 })
    .lean();

const assignmentRows = (organizationId, staffId) =>
  RequirementAssignment.aggregate([
    { $match: { organizationId, staffId } },
    {
      $lookup: {
        from: Requirement.collection.name,
        localField: "requirementId",
        foreignField: "_id",
        pipeline: [
          {
            $project: {
              type: 1,
              renewalMonths: 1,
              firstCompletionDays: 1,
              amberDaysOverride: 1,
            },
          },
          { $limit: 1 },
        ],
        as: "requirement",
      },
    },
    { $unwind: "$requirement" },
    {
      $lookup: {
        from: RequirementRecord.collection.name,
        let: { assignmentId: "$_id" },
        pipeline: [
          { $match: { $expr: { $eq: ["$assignmentId", "$$assignmentId"] } } },
          { $sort: { completedAt: -1 } },
          { $limit: 1 },
        ],
        as: "latest",
      },
    },
  ]);

const myCompliance = async ({ actor, organizationId }) => {
  const orgOid = toOid(organizationId, "invalid_organization_id");
  const staff = await loadStaff(actor, organizationId);

  const [organization, branch, supervisions, appraisals, assignments, drills] =
    await Promise.all([
      Organization.findById(organizationId)
        .select(
          "settings.defaultSupervisionIntervalMonths settings.defaultAppraisalIntervalMonths settings.amberDays"
        )
        .lean(),
      staff.branchId
        ? Branch.findById(staff.branchId).select("timezone").lean()
        : null,
      meetingsOf(SupervisionRecord, orgOid, staff._id),
      meetingsOf(AppraisalRecord, orgOid, staff._id),
      assignmentRows(orgOid, staff._id),
      fireDrillScore({ staffId: staff._id, branchId: staff.branchId }),
    ]);
  if (!organization) throw new AppError("organization_not_found", 404);

  const timezone = branch?.timezone || DEFAULT_TZ;
  const settings = organization.settings || {};
  const intervals = effectiveIntervals(staff, settings);
  const amberDays = settings.amberDays ?? null;

  const supervision = supervisionStanding({
    startDate: staff.startDate,
    intervalMonths: intervals.supervisionMonths,
    meetings: supervisions,
    timezone,
  });

  const appraisalMeetings = appraisals.filter(
    (meeting) =>
      meeting.status === ComplianceMeetingStatus.SCHEDULED ||
      (meeting.status === ComplianceMeetingStatus.COMPLETED &&
        meeting.kind !== AppraisalKind.OTHER)
  );
  const appraisal = supervisionStanding({
    startDate: staff.startDate,
    intervalMonths: intervals.appraisalMonths,
    meetings: appraisalMeetings,
    timezone,
  });

  return {
    supervision: meetingScore(supervision),
    appraisal: meetingScore(appraisal),
    competency: scoreAssignments(
      assignments,
      RequirementType.COMPETENCY,
      amberDays
    ),
    training: scoreAssignments(assignments, RequirementType.TRAINING, amberDays),
    fireDrills: drills,
  };
};

module.exports = { myCompliance };
