/**
 * Seed demo data for Demo Care Group / Smoke Site for local testing.
 *
 * Usage:
 *   node scripts/seed-demo-smoke-site.js
 *
 * Optional env overrides:
 *   SEED_ORG_ID, SEED_BRANCH_ID
 */
require("dotenv").config({
  path: require("path").join(__dirname, "..", ".env"),
});

const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
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
const { Department } = require("@models/Department");
const { JobTitle } = require("@models/JobTitle");
const { Membership } = require("@models/Membership");
const { StaffProfile } = require("@models/StaffProfile");
const { Shift } = require("@models/Shift");
const { LeaveEntitlement } = require("@models/LeaveEntitlement");
const { LeaveRequest } = require("@models/LeaveRequest");
const { AttendanceDay } = require("@models/AttendanceDay");
const { Kiosk } = require("@models/Kiosk");
const branchService = require("@adminServices/organizations/branchService");
const {
  MembershipRole,
  ActiveInactiveStatus,
  StaffProfileStatus,
  JobTitleLevel,
  ShiftStatus,
  ShiftVisibility,
  LeaveType,
  LeaveRequestStatus,
  LeaveRequestSource,
  CheckInMethod,
  PunctualityStatus,
  PresenceStatus,
  KioskSetupStatus,
  KioskMode,
  BranchStatus,
} = require("@models/domainEnums");

const ORG_ID = process.env.SEED_ORG_ID || "6a9576de4f38edb8df164091";
const BRANCH_ID = process.env.SEED_BRANCH_ID || "6a966660a84bca033b0d34d6";
const DEMO_PIN = "1234";
const DEMO_PASSWORD = "demoTempy11";
const LEAVE_YEAR = "2026-2027";

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

const randomToken = () => crypto.randomBytes(24).toString("hex");

const ensureDepartment = async (organizationId, name) => {
  let row = await Department.findOne({ organizationId, name }).lean();
  if (row) return row;
  row = await Department.create({
    organizationId,
    branchId: null,
    name,
    sortOrder: 0,
    active: true,
  });
  return row.toObject();
};

const ensureJobTitle = async (organizationId, name, level) => {
  let row = await JobTitle.findOne({ organizationId, name }).lean();
  if (row) return row;
  row = await JobTitle.create({
    organizationId,
    branchId: null,
    name,
    level,
    active: true,
  });
  return row.toObject();
};

const ensureUser = async ({ email, name }) => {
  let user = await User.findOne({ email: email.toLowerCase() });
  if (user) return user;
  user = await User.create({
    name,
    email: email.toLowerCase(),
    password: DEMO_PASSWORD,
    timezone: "Europe/London",
    accountState: { userType: "user", status: "active" },
    verificationStatus: { email: "verified", phoneNumber: "pending" },
  });
  return user;
};

const ensureMembership = async ({
  userId,
  organizationId,
  branchId,
  role,
}) => {
  let membership = await Membership.findOne({
    userId,
    organizationId,
    branchId,
  });
  if (membership) {
    membership.role = role;
    membership.status = ActiveInactiveStatus.ACTIVE;
    await membership.save();
    return membership;
  }
  return Membership.create({
    userId,
    organizationId,
    branchId,
    role,
    permissions: [],
    status: ActiveInactiveStatus.ACTIVE,
  });
};

const ensureStaffProfile = async ({
  userId,
  organizationId,
  branchId,
  jobTitleId,
  departmentIds,
  employeeCode,
  nfcTagId,
  pinHash,
}) => {
  let profile = await StaffProfile.findOne({ userId, organizationId });
  if (profile) {
    profile.branchId = branchId;
    profile.jobTitleId = jobTitleId;
    profile.departmentIds = departmentIds;
    if (nfcTagId) profile.nfcTagId = nfcTagId;
    if (pinHash) profile.pinHash = pinHash;
    profile.status = StaffProfileStatus.ACTIVE;
    await profile.save();
    return profile;
  }

  return StaffProfile.create({
    userId,
    organizationId,
    branchId,
    employeeCode,
    jobTitleId,
    departmentIds,
    reportsToStaffId: null,
    startDate: new Date("2026-01-15T00:00:00.000Z"),
    qrToken: randomToken(),
    nfcTagId,
    pinHash,
    phone: "",
    status: StaffProfileStatus.ACTIVE,
  });
};

const ensureLeaveEntitlement = async ({ staffId, branchId }) => {
  const existing = await LeaveEntitlement.findOne({
    staffId,
    year: LEAVE_YEAR,
    leaveType: LeaveType.ANNUAL,
  });
  if (existing) return existing;
  return LeaveEntitlement.create({
    staffId,
    branchId,
    year: LEAVE_YEAR,
    leaveType: LeaveType.ANNUAL,
    entitlementDays: 28,
    carriedOverDays: 2,
    takenDays: 0,
    pendingDays: 0,
  });
};

const ensureShift = async ({
  organizationId,
  branchId,
  staffId,
  startsAt,
  endsAt,
  status,
  key,
}) => {
  // Idempotent via client-ish marker in a stable time window + staff/status.
  const existing = await Shift.findOne({
    organizationId,
    branchId,
    startsAt,
    endsAt,
    status,
    staffId: staffId || null,
  });
  if (existing) return existing;

  return Shift.create({
    organizationId,
    branchId,
    staffId: staffId || null,
    startsAt,
    endsAt,
    status,
    visibility: ShiftVisibility.BRANCH,
    urgentCover: status === ShiftStatus.OPEN,
    openedAt: status === ShiftStatus.OPEN ? new Date() : null,
    filledAt: status === ShiftStatus.SCHEDULED && staffId ? new Date() : null,
  });
};

async function main() {
  await mongoose.connect(process.env.BASE_URL);

  const organization = await Organization.findById(ORG_ID);
  if (!organization) throw new Error(`Organization ${ORG_ID} not found`);

  const branch = await Branch.findById(BRANCH_ID);
  if (!branch) throw new Error(`Branch ${BRANCH_ID} not found`);
  if (String(branch.organizationId) !== String(organization._id)) {
    throw new Error("Branch does not belong to organization");
  }

  branch.status = BranchStatus.ACTIVE;
  branch.settings = {
    ...(branch.settings?.toObject?.() || branch.settings || {}),
    enableBreaks: true,
    lateGraceMinutes: 10,
    allowPhoneCheckIn: true,
  };
  branch.address = branch.address || {
    line1: "12 Smoke Lane",
    city: "London",
    postcode: "SW1A 1AA",
    county: "Greater London",
  };
  if (!branch.activatedAt) branch.activatedAt = new Date();
  await branch.save();

  const careDept = await ensureDepartment(organization._id, "Care");
  const kitchenDept = await ensureDepartment(organization._id, "Kitchen");
  const carerTitle = await ensureJobTitle(
    organization._id,
    "Carer",
    JobTitleLevel.OPERATIONAL
  );
  const nurseTitle = await ensureJobTitle(
    organization._id,
    "Nurse",
    JobTitleLevel.OPERATIONAL
  );
  const helperTitle = await ensureJobTitle(
    organization._id,
    "Helper",
    JobTitleLevel.OPERATIONAL
  );

  const pinHash = await bcrypt.hash(DEMO_PIN, 10);

  const demoStaff = [
    {
      email: "carer1.smoke@tempyhub.com",
      name: "Amina Carer",
      role: MembershipRole.STAFF,
      jobTitleId: carerTitle._id,
      departmentIds: [careDept._id],
      employeeCode: "EMP-SEED1",
      nfcTagId: "NFC-SMOKE-SEED-1",
    },
    {
      email: "carer2.smoke@tempyhub.com",
      name: "Ben Carer",
      role: MembershipRole.STAFF,
      jobTitleId: carerTitle._id,
      departmentIds: [careDept._id],
      employeeCode: "EMP-SEED2",
      nfcTagId: "NFC-SMOKE-SEED-2",
    },
    {
      email: "nurse1.smoke@tempyhub.com",
      name: "Nadia Nurse",
      role: MembershipRole.STAFF,
      jobTitleId: nurseTitle._id,
      departmentIds: [careDept._id],
      employeeCode: "EMP-SEED3",
      nfcTagId: "NFC-SMOKE-SEED-3",
    },
    {
      email: "helper1.smoke@tempyhub.com",
      name: "Hari Helper",
      role: MembershipRole.STAFF,
      jobTitleId: helperTitle._id,
      departmentIds: [kitchenDept._id],
      employeeCode: "EMP-SEED4",
      nfcTagId: "NFC-SMOKE-SEED-4",
    },
  ];

  const seededProfiles = [];
  for (const spec of demoStaff) {
    const user = await ensureUser({ email: spec.email, name: spec.name });
    await ensureMembership({
      userId: user._id,
      organizationId: organization._id,
      branchId: branch._id,
      role: spec.role,
    });
    const profile = await ensureStaffProfile({
      userId: user._id,
      organizationId: organization._id,
      branchId: branch._id,
      jobTitleId: spec.jobTitleId,
      departmentIds: spec.departmentIds,
      employeeCode: spec.employeeCode,
      nfcTagId: spec.nfcTagId,
      pinHash,
    });
    await ensureLeaveEntitlement({
      staffId: profile._id,
      branchId: branch._id,
    });
    seededProfiles.push({
      email: spec.email,
      name: spec.name,
      staffId: String(profile._id),
      employeeCode: profile.employeeCode,
      nfcTagId: spec.nfcTagId,
    });
  }

  // Also ensure leave for existing branch staff (owner profile + new.carer)
  const existingBranchStaff = await StaffProfile.find({
    organizationId: organization._id,
    branchId: branch._id,
  }).lean();
  for (const profile of existingBranchStaff) {
    await ensureLeaveEntitlement({
      staffId: profile._id,
      branchId: branch._id,
    });
  }

  const now = new Date();
  const today = utcDay(now);
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  const amina = seededProfiles[0];
  const ben = seededProfiles[1];
  const nadia = seededProfiles[2];

  // Today: active clock-in eligible shifts (started earlier, end later)
  const todayMorningStart = atUtc(today, Math.max(0, now.getUTCHours() - 2), 0);
  const todayMorningEnd = atUtc(today, Math.min(23, now.getUTCHours() + 6), 0);
  const todayAfternoonStart = atUtc(today, Math.max(0, now.getUTCHours() - 1), 0);
  const todayAfternoonEnd = atUtc(today, Math.min(23, now.getUTCHours() + 7), 0);

  await ensureShift({
    organizationId: organization._id,
    branchId: branch._id,
    staffId: amina.staffId,
    startsAt: todayMorningStart,
    endsAt: todayMorningEnd,
    status: ShiftStatus.SCHEDULED,
  });
  await ensureShift({
    organizationId: organization._id,
    branchId: branch._id,
    staffId: ben.staffId,
    startsAt: todayAfternoonStart,
    endsAt: todayAfternoonEnd,
    status: ShiftStatus.SCHEDULED,
  });
  await ensureShift({
    organizationId: organization._id,
    branchId: branch._id,
    staffId: nadia.staffId,
    startsAt: todayMorningStart,
    endsAt: todayMorningEnd,
    status: ShiftStatus.SCHEDULED,
  });

  // Tomorrow open + scheduled
  await ensureShift({
    organizationId: organization._id,
    branchId: branch._id,
    staffId: null,
    startsAt: atUtc(tomorrow, 7, 0),
    endsAt: atUtc(tomorrow, 15, 0),
    status: ShiftStatus.OPEN,
  });
  await ensureShift({
    organizationId: organization._id,
    branchId: branch._id,
    staffId: seededProfiles[3].staffId,
    startsAt: atUtc(tomorrow, 15, 0),
    endsAt: atUtc(tomorrow, 23, 0),
    status: ShiftStatus.SCHEDULED,
  });

  // Pending leave for Amina
  const aminaUser = await User.findOne({ email: amina.email }).select("_id");
  const pendingLeave = await LeaveRequest.findOne({
    staffId: amina.staffId,
    status: LeaveRequestStatus.PENDING,
  });
  if (!pendingLeave) {
    await LeaveRequest.create({
      branchId: branch._id,
      staffId: amina.staffId,
      leaveType: LeaveType.ANNUAL,
      source: LeaveRequestSource.STAFF_REQUEST,
      status: LeaveRequestStatus.PENDING,
      startDate: atUtc(tomorrow, 0, 0),
      endDate: atUtc(tomorrow, 0, 0),
      totalDays: 1,
      reason: "Seeded demo leave request",
      createdBy: aminaUser._id,
    });
  }

  // Yesterday completed attendance for Ben
  const yesterday = new Date(today);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yStart = atUtc(yesterday, 8, 0);
  const yEnd = atUtc(yesterday, 16, 0);
  const existingAttendance = await AttendanceDay.findOne({
    staffId: ben.staffId,
    workDate: utcDay(yesterday),
  });
  if (!existingAttendance) {
    await AttendanceDay.create({
      staffId: ben.staffId,
      branchId: branch._id,
      workDate: utcDay(yesterday),
      clockInAt: yStart,
      clockOutAt: yEnd,
      breaks: [
        {
          breakInAt: atUtc(yesterday, 12, 0),
          breakOutAt: atUtc(yesterday, 12, 30),
        },
      ],
      checkInMethod: CheckInMethod.KIOSK,
      punctualityStatus: PunctualityStatus.ON_TIME,
      presenceStatus: PresenceStatus.CHECKED_OUT,
      workedMinutes: 7.5 * 60,
      clientEventId: `seed-ben-attendance-${utcDay(yesterday).toISOString()}`,
    });
  }

  // Demo kiosk (registered) for Smoke Site.
  // Use a unique nfcTagId — sparse unique indexes still collide on explicit null.
  let kiosk = await Kiosk.findOne({ deviceId: "seed-smoke-kiosk-1" });
  if (!kiosk) {
    kiosk = await Kiosk.create({
      branchId: branch._id,
      deviceId: "seed-smoke-kiosk-1",
      receptionIdentifier: "Front desk",
      locationLabel: "Main entrance",
      adminPinHash: await bcrypt.hash("9999", 10),
      setupStatus: KioskSetupStatus.REGISTERED,
      kioskMode: KioskMode.LOCKED,
      scanToken: randomToken(),
      scanTokenExpiresAt: new Date(Date.now() + 2 * 60 * 1000),
      nfcTagId: "NFC-KIOSK-SMOKE-1",
    });
  }

  // Fresh activation code for pairing another device
  const owner = await User.findOne({ email: "owner@tempyhub.com" });
  let activation = null;
  if (owner) {
    activation = await branchService.issueActivationCode({
      branchId: branch._id,
      organizationId: organization._id,
      issuedByUserId: owner._id,
    });
  }

  const summary = {
    organization: { id: String(organization._id), name: organization.name },
    branch: {
      id: String(branch._id),
      name: branch.name,
      code: branch.code,
      status: branch.status,
      allowPhoneCheckIn: branch.settings?.allowPhoneCheckIn,
    },
    loginPassword: DEMO_PASSWORD,
    staffPin: DEMO_PIN,
    staff: seededProfiles,
    kiosk: {
      deviceId: kiosk.deviceId,
      id: String(kiosk._id),
      adminPin: "9999",
    },
    activationCode: activation?.code || null,
    notes: [
      "Today scheduled shifts exist for Amina, Ben, and Nadia (clock-in eligible).",
      "Tomorrow has one open shift and one scheduled for Hari.",
      "Ben has yesterday attendance history.",
      "Amina has a pending leave request for tomorrow.",
      "Use activationCode to register another kiosk device if needed.",
    ],
  };

  console.log(JSON.stringify(summary, null, 2));
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
