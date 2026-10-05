/**
 * Seed clock-in rows plus sick/absence leave for the attendance table + rota.
 *
 *   node scripts/seed-attendance-listing.js
 *   node scripts/seed-attendance-listing.js <organizationId>
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
const moment = require("moment-timezone");
const { User } = require("@models/UserModel");
const { Organization } = require("@models/Organization");
const { Branch } = require("@models/Branch");
const { StaffProfile } = require("@models/StaffProfile");
const { LeaveRequest } = require("@models/LeaveRequest");
const { AttendanceDay } = require("@models/AttendanceDay");
const {
  LeaveType,
  LeaveRequestStatus,
  LeaveRequestSource,
  CheckInMethod,
  PunctualityStatus,
  PresenceStatus,
  StaffProfileStatus,
} = require("@models/domainEnums");

const TZ = "Europe/London";

const utcDay = (d) => {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
};

const atUtc = (base, hours, minutes = 0) => {
  const d = utcDay(base);
  d.setUTCHours(hours, minutes, 0, 0);
  return d;
};

const resolveOrgId = async () => {
  const fromArg = process.argv[2];
  if (fromArg) return fromArg;
  if (process.env.SEED_ORG_ID) return process.env.SEED_ORG_ID;

  const [top] = await StaffProfile.aggregate([
    { $match: { status: StaffProfileStatus.ACTIVE } },
    { $group: { _id: "$organizationId", n: { $sum: 1 } } },
    { $sort: { n: -1 } },
    { $limit: 1 },
  ]);
  return top?._id ? String(top._id) : null;
};

const ensureAttendance = async (doc) => {
  const existing = await AttendanceDay.findOne({
    staffId: doc.staffId,
    workDate: doc.workDate,
  });
  if (existing) return { row: existing, created: false };
  const row = await AttendanceDay.create(doc);
  return { row, created: true };
};

const ensureLeave = async (doc) => {
  const existing = await LeaveRequest.findOne({
    staffId: doc.staffId,
    leaveType: doc.leaveType,
    startDate: doc.startDate,
    endDate: doc.endDate,
    status: { $in: [LeaveRequestStatus.APPROVED, LeaveRequestStatus.CLOSED] },
  });
  if (existing) return { row: existing, created: false };
  const row = await LeaveRequest.create(doc);
  return { row, created: true };
};

async function main() {
  await mongoose.connect(process.env.BASE_URL);

  const orgId = await resolveOrgId();
  if (!orgId) {
    throw new Error("No organization with staff found. Pass an organizationId.");
  }

  const organization = await Organization.findById(orgId);
  if (!organization) throw new Error(`Organization ${orgId} not found`);

  const branchFilter = { organizationId: organization._id };
  if (process.env.SEED_BRANCH_ID) branchFilter._id = process.env.SEED_BRANCH_ID;
  const branch = await Branch.findOne(branchFilter);
  if (!branch) throw new Error(`No branch for organization ${orgId}`);

  const staff = await StaffProfile.find({
    organizationId: organization._id,
    branchId: branch._id,
    status: StaffProfileStatus.ACTIVE,
  })
    .sort({ employeeCode: 1 })
    .limit(4)
    .lean();

  if (!staff.length) {
    throw new Error(
      `No active staff on branch ${branch._id}. Seed staff first (scripts/seed-demo-smoke-site.js).`
    );
  }

  const createdBy =
    staff[0].userId ||
    (await User.findOne({ email: "owner@tempyhub.com" }).select("_id"))?._id;
  if (!createdBy) throw new Error("Need a user id for leave createdBy");

  const monday = moment.tz(TZ).startOf("isoWeek");
  const days = [0, 1, 2, 3, 4].map((offset) =>
    utcDay(monday.clone().add(offset, "days").toDate())
  );
  const [mon, tue, wed, thu, fri] = days;

  const [a, b, c, d] = staff;
  let attendanceCreated = 0;
  let leaveCreated = 0;

  const clock = async (profile, day, inH, inM, outH, outM, punctuality) => {
    const { created } = await ensureAttendance({
      staffId: profile._id,
      branchId: branch._id,
      workDate: utcDay(day),
      clockInAt: atUtc(day, inH, inM),
      clockOutAt: atUtc(day, outH, outM),
      breaks: [
        {
          breakInAt: atUtc(day, 12, 0),
          breakOutAt: atUtc(day, 12, 30),
        },
      ],
      checkInMethod: CheckInMethod.KIOSK,
      punctualityStatus: punctuality,
      presenceStatus: PresenceStatus.CHECKED_OUT,
      workedMinutes: 450,
      clientEventId: `seed-att-${profile._id}-${utcDay(day).toISOString().slice(0, 10)}`,
    });
    if (created) attendanceCreated += 1;
  };

  const leave = async (profile, day, leaveType) => {
    const workDate = utcDay(day);
    const { created } = await ensureLeave({
      staffId: profile._id,
      organizationId: organization._id,
      branchId: branch._id,
      leaveType,
      source: LeaveRequestSource.MANAGER_RECORDED,
      status: LeaveRequestStatus.CLOSED,
      startDate: workDate,
      endDate: workDate,
      totalDays: 1,
      reason: `Seeded ${leaveType}`,
      createdBy,
      recordedByUserId: createdBy,
    });
    if (created) leaveCreated += 1;
  };

  if (a) {
    await clock(a, tue, 14, 15, 22, 25, PunctualityStatus.LATE);
    await clock(a, thu, 13, 22, 20, 5, PunctualityStatus.LATE);
  }
  if (b) {
    await clock(b, wed, 13, 0, 21, 0, PunctualityStatus.ON_TIME);
    await leave(b, fri, LeaveType.SICK);
    await leave(b, mon, LeaveType.ABSENCE);
  }
  if (c) {
    await clock(c, tue, 14, 15, 22, 20, PunctualityStatus.LATE);
  }
  if (d) {
    await clock(d, thu, 12, 58, 20, 0, PunctualityStatus.ON_TIME);
  }

  console.log(
    JSON.stringify(
      {
        organization: { id: String(organization._id), name: organization.name },
        branch: { id: String(branch._id), name: branch.name },
        staff: staff.map((s) => ({
          staffId: String(s._id),
          employeeCode: s.employeeCode,
        })),
        weekStart: monday.format("YYYY-MM-DD"),
        attendanceCreated,
        leaveCreated,
        list: `GET /admin/organizations/${organization._id}/attendance`,
        rota: `GET /admin/organizations/${organization._id}/attendance/rota?from=${monday.format("YYYY-MM-DD")}&to=${monday.clone().add(4, "days").format("YYYY-MM-DD")}`,
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
