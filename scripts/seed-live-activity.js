/**
 * Seed Site Live activity + Team Live (counts, activity, rota).
 *
 *   node scripts/seed-live-activity.js
 *   node scripts/seed-live-activity.js <organizationId>
 *
 * Optional: SEED_ORG_ID, SEED_BRANCH_ID
 */
require("dotenv").config({
  path: require("path").join(__dirname, "..", ".env.dev"),
});

const path = require("path");
const moduleAlias = require("module-alias");
const aliases = require("../aliasConfig/pathAliases.config");
for (const [alias, target] of Object.entries(aliases)) {
  moduleAlias.addAlias(alias, path.join(__dirname, "..", target));
}
require("module-alias/register");

const mongoose = require("mongoose");
const { User } = require("@models/UserModel");
const { Organization } = require("@models/Organization");
const { Branch } = require("@models/Branch");
const { StaffProfile } = require("@models/StaffProfile");
const { Membership } = require("@models/Membership");
const { Shift } = require("@models/Shift");
const { LeaveRequest } = require("@models/LeaveRequest");
const { AttendanceDay } = require("@models/AttendanceDay");
const { ExternalPerson } = require("@models/ExternalPerson");
const { VisitSession } = require("@models/VisitSession");
const { EvacuationEvent } = require("@models/EvacuationEvent");
const {
  MembershipRole,
  ActiveInactiveStatus,
  StaffProfileStatus,
  ShiftStatus,
  ShiftVisibility,
  LeaveType,
  LeaveRequestStatus,
  LeaveRequestSource,
  CheckInMethod,
  PunctualityStatus,
  PresenceStatus,
  ExternalPersonType,
  VisitMethod,
  VisitSessionStatus,
  EvacuationType,
  EvacuationStatus,
} = require("@models/domainEnums");

const utcDay = (d) => {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
};

const hoursAgo = (n) => new Date(Date.now() - n * 60 * 60 * 1000);
const hoursAhead = (n) => new Date(Date.now() + n * 60 * 60 * 1000);

const resolveOrgId = async () => {
  if (process.argv[2]) return process.argv[2];
  if (process.env.SEED_ORG_ID) return process.env.SEED_ORG_ID;
  const [top] = await StaffProfile.aggregate([
    { $match: { status: StaffProfileStatus.ACTIVE } },
    { $group: { _id: "$organizationId", n: { $sum: 1 } } },
    { $sort: { n: -1 } },
    { $limit: 1 },
  ]);
  return top?._id ? String(top._id) : null;
};

const upsertAttendance = async (doc) => {
  await AttendanceDay.findOneAndUpdate(
    { staffId: doc.staffId, workDate: doc.workDate },
    { $set: doc },
    { upsert: true, new: true }
  );
};

async function main() {
  await mongoose.connect(process.env.BASE_URL);

  const orgId = await resolveOrgId();
  if (!orgId) throw new Error("No organization with staff. Run seed-demo-smoke-site.js first.");

  const organization = await Organization.findById(orgId);
  if (!organization) throw new Error(`Organization ${orgId} not found`);

  let branch = null;
  if (process.env.SEED_BRANCH_ID) {
    branch = await Branch.findOne({
      _id: process.env.SEED_BRANCH_ID,
      organizationId: organization._id,
    });
  } else {
    const [topBranch] = await StaffProfile.aggregate([
      {
        $match: {
          organizationId: organization._id,
          status: StaffProfileStatus.ACTIVE,
        },
      },
      { $group: { _id: "$branchId", n: { $sum: 1 } } },
      { $sort: { n: -1 } },
      { $limit: 1 },
    ]);
    if (topBranch?._id) {
      branch = await Branch.findById(topBranch._id);
    }
  }
  if (!branch) {
    branch = await Branch.findOne({ organizationId: organization._id });
  }
  if (!branch) throw new Error(`No branch for organization ${orgId}`);

  const staff = await StaffProfile.find({
    organizationId: organization._id,
    branchId: branch._id,
    status: StaffProfileStatus.ACTIVE,
  })
    .sort({ employeeCode: 1 })
    .limit(6)
    .lean();

  if (staff.length < 2) {
    throw new Error(
      `Need at least 2 active staff on branch ${branch._id}. Run scripts/seed-demo-smoke-site.js first.`
    );
  }

  const [manager, a, b, c] = staff;
  const createdBy = manager.userId;

  await Membership.findOneAndUpdate(
    {
      userId: manager.userId,
      organizationId: organization._id,
      branchId: branch._id,
    },
    {
      $set: {
        role: MembershipRole.LINE_MANAGER,
        status: ActiveInactiveStatus.ACTIVE,
      },
    }
  );

  const reportIds = staff.slice(1).map((row) => row._id);
  await StaffProfile.updateMany(
    { _id: { $in: reportIds } },
    { $set: { reportsToStaffId: manager._id } }
  );

  const today = utcDay(new Date());
  const yesterday = utcDay(hoursAgo(24));

  await upsertAttendance({
    staffId: a._id,
    branchId: branch._id,
    workDate: today,
    clockInAt: hoursAgo(2),
    clockOutAt: null,
    checkInMethod: CheckInMethod.KIOSK,
    punctualityStatus: PunctualityStatus.ON_TIME,
    presenceStatus: PresenceStatus.ON_SITE,
    workedMinutes: null,
    clientEventId: `seed-live-att-${a._id}-${today.toISOString().slice(0, 10)}`,
  });

  await upsertAttendance({
    staffId: b._id,
    branchId: branch._id,
    workDate: today,
    clockInAt: hoursAgo(1),
    clockOutAt: null,
    checkInMethod: CheckInMethod.PHONE,
    punctualityStatus: PunctualityStatus.LATE,
    presenceStatus: PresenceStatus.ON_SITE,
    workedMinutes: null,
    clientEventId: `seed-live-att-${b._id}-${today.toISOString().slice(0, 10)}`,
  });

  if (c) {
    await upsertAttendance({
      staffId: c._id,
      branchId: branch._id,
      workDate: yesterday,
      clockInAt: new Date(yesterday.getTime() + 8 * 3600000),
      clockOutAt: new Date(yesterday.getTime() + 16 * 3600000),
      checkInMethod: CheckInMethod.KIOSK,
      punctualityStatus: PunctualityStatus.ON_TIME,
      presenceStatus: PresenceStatus.CHECKED_OUT,
      workedMinutes: 480,
      clientEventId: `seed-live-att-${c._id}-${yesterday.toISOString().slice(0, 10)}`,
    });
  }

  const shiftSpecs = [a, b].map((row) => ({
    organizationId: organization._id,
    branchId: branch._id,
    staffId: row._id,
    startsAt: hoursAgo(3),
    endsAt: hoursAhead(5),
    status: ShiftStatus.SCHEDULED,
    visibility: ShiftVisibility.BRANCH,
    filledAt: new Date(),
  }));
  for (const spec of shiftSpecs) {
    const existing = await Shift.findOne({
      organizationId: spec.organizationId,
      staffId: spec.staffId,
      status: ShiftStatus.SCHEDULED,
      startsAt: { $lt: spec.endsAt },
      endsAt: { $gt: spec.startsAt },
    });
    if (!existing) await Shift.create(spec);
  }

  const pendingLeave = await LeaveRequest.findOne({
    staffId: a._id,
    status: LeaveRequestStatus.PENDING,
    reason: "Seeded team-live leave request",
  });
  if (!pendingLeave) {
    await LeaveRequest.create({
      organizationId: organization._id,
      branchId: branch._id,
      staffId: a._id,
      leaveType: LeaveType.ANNUAL,
      source: LeaveRequestSource.STAFF_REQUEST,
      status: LeaveRequestStatus.PENDING,
      startDate: hoursAhead(24),
      endDate: hoursAhead(48),
      totalDays: 1,
      reason: "Seeded team-live leave request",
      createdBy: a.userId,
    });
  }

  const sick = await LeaveRequest.findOne({
    staffId: b._id,
    leaveType: LeaveType.SICK,
    reason: "Seeded team-live sick",
  });
  if (!sick) {
    await LeaveRequest.create({
      organizationId: organization._id,
      branchId: branch._id,
      staffId: b._id,
      leaveType: LeaveType.SICK,
      source: LeaveRequestSource.STAFF_REQUEST,
      status: LeaveRequestStatus.APPROVED,
      startDate: utcDay(new Date()),
      endDate: utcDay(new Date()),
      totalDays: 1,
      reason: "Seeded team-live sick",
      createdBy: b.userId,
      decidedBy: createdBy,
      decidedAt: hoursAgo(0.5),
    });
  } else {
    sick.status = LeaveRequestStatus.APPROVED;
    sick.decidedAt = hoursAgo(0.5);
    sick.decidedBy = createdBy;
    await sick.save();
  }

  let visitor = await ExternalPerson.findOne({
    branchId: branch._id,
    email: "seed.visitor.live@example.com",
  });
  if (!visitor) {
    visitor = await ExternalPerson.create({
      branchId: branch._id,
      type: ExternalPersonType.VISITOR,
      name: "Seed Live Visitor",
      email: "seed.visitor.live@example.com",
      phone: "+447700900111",
    });
  }

  const approvedVisit = await VisitSession.findOne({
    branchId: branch._id,
    purposeOfVisit: "Seeded site-live approved visit",
  });
  if (!approvedVisit) {
    await VisitSession.create({
      branchId: branch._id,
      externalPersonId: visitor._id,
      personType: ExternalPersonType.VISITOR,
      method: VisitMethod.WALK_IN,
      hostStaffId: a._id,
      status: VisitSessionStatus.ON_SITE,
      purposeOfVisit: "Seeded site-live approved visit",
      arrivedAt: hoursAgo(3),
      checkInAt: hoursAgo(2.8),
    });
  }

  const deniedVisit = await VisitSession.findOne({
    branchId: branch._id,
    purposeOfVisit: "Seeded site-live denied visit",
  });
  if (!deniedVisit) {
    await VisitSession.create({
      branchId: branch._id,
      externalPersonId: visitor._id,
      personType: ExternalPersonType.VISITOR,
      method: VisitMethod.WALK_IN,
      hostStaffId: a._id,
      status: VisitSessionStatus.DENIED,
      purposeOfVisit: "Seeded site-live denied visit",
      arrivedAt: hoursAgo(4),
    });
  }

  const closedEvac = await EvacuationEvent.findOne({
    branchId: branch._id,
    type: EvacuationType.MOCK,
    status: EvacuationStatus.CLOSED,
  });
  if (!closedEvac) {
    await EvacuationEvent.create({
      branchId: branch._id,
      type: EvacuationType.MOCK,
      status: EvacuationStatus.CLOSED,
      startedAt: hoursAgo(6),
      closedAt: hoursAgo(5),
      startedByUserId: createdBy,
    });
  }

  console.log(
    JSON.stringify(
      {
        organization: { id: String(organization._id), name: organization.name },
        branch: { id: String(branch._id), name: branch.name },
        lineManagerStaffId: String(manager._id),
        lineManagerUserId: String(manager.userId),
        reports: reportIds.map(String),
        hit: {
          siteLiveActivity: `GET /admin/organizations/${organization._id}/site-live/activity?page=1&limit=20&branchId=${branch._id}`,
          teamLive: `GET /admin/organizations/${organization._id}/team-live?period=daily`,
          teamLiveActivity: `GET /admin/organizations/${organization._id}/team-live/activity?page=1&limit=20`,
          teamRota: `GET /admin/organizations/${organization._id}/team-live/rota?view=day`,
        },
      },
      null,
      2
    )
  );

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
