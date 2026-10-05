const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const moment = require("moment-timezone");
const { paginateWithFacet, keywordOr, facetCount } = require("@utils/paginate");
const {
  actorStanding,
  assertMayManageStaff,
  assertBranchInOrganization,
  scopeBranchFilter,
} = require("@adminServices/staff/staffAccess");
const { generateMeta } = require("@utils/responseUtil");
const { Kiosk } = require("@models/Kiosk");
const { KioskPairingSession } = require("@models/KioskPairingSession");
const { BranchActivationCode } = require("@models/BranchActivationCode");
const { Branch } = require("@models/Branch");
const { Organization } = require("@models/Organization");
const { StaffProfile } = require("@models/StaffProfile");
const { User } = require("@models/UserModel");
const { JobTitle } = require("@models/JobTitle");
const { Department } = require("@models/Department");
const { VisitSession } = require("@models/VisitSession");
const { ExternalPerson } = require("@models/ExternalPerson");
const { AppError } = require("@services/_errors/AppError");
const { signKioskToken } = require("@middlewares/kioskMiddleware");
const { verifyActivationCode, issueActivationCode } = require("@adminServices/organizations/branchService");
const attendanceService = require("@adminServices/attendance/attendanceService");
const communicationService = require("@commonServices/communication/communicationService");
const { emitKioskPairingReady } = require("@config/sockets/kiosk/kioskSocketEmitter");
const {
  BranchStatus,
  OrganizationStatus,
  KioskSetupStatus,
  KioskMode,
  KioskDeviceType,
  KioskPairingStatus,
  ModuleSlug,
  StaffProfileStatus,
  CheckInMethod,
  VisitSessionStatus,
} = require("@models/domainEnums");

const MIN_SEARCH_LENGTH = 2;
const SCAN_TOKEN_TTL_MS = 2 * 60 * 1000;
const PAIRING_SESSION_TTL_MS = 3 * 60 * 1000;

const escapeRegex = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const publicAddress = (address) => {
  if (!address || typeof address !== "object") return null;
  const pick = (key) => {
    const value = address[key];
    return value == null ? "" : String(value);
  };
  const summary = {
    line1: pick("line1"),
    line2: pick("line2"),
    city: pick("city"),
    postcode: pick("postcode"),
    county: pick("county"),
  };
  return Object.values(summary).some((part) => part.trim() !== "")
    ? summary
    : null;
};

const isModuleEnabled = (organization, moduleSlug) => {
  const entry = (organization.moduleAccess || []).find(
    (m) => m.moduleSlug === moduleSlug
  );
  return (
    entry &&
    entry.enabled &&
    (!entry.expiresAt || new Date(entry.expiresAt) > new Date())
  );
};

const loadEligibleOrganizations = async () => {
  const orgs = await Organization.find({ status: OrganizationStatus.ACTIVE })
    .select("_id name moduleAccess")
    .lean();

  return orgs.filter((org) =>
    isModuleEnabled(org, ModuleSlug.SIGN_IN_ATTENDANCE)
  );
};

/**
 * Public branch lookup for kiosk setup. Single keyword matches organization
 * name, branch name, branch code, or address/postcode fields.
 */
const searchBranchesForKiosk = async ({ keyword, page, limit, skip }) => {
  const term = String(keyword ?? "").trim();
  if (term.length < MIN_SEARCH_LENGTH) {
    throw new AppError("kiosk_branch_search_term_too_short", 400);
  }

  const eligibleOrgs = await loadEligibleOrganizations();
  if (!eligibleOrgs.length) {
    return { data: [], meta: generateMeta(page, limit, 0) };
  }

  const orgById = new Map(eligibleOrgs.map((org) => [String(org._id), org]));
  const regex = { $regex: escapeRegex(term), $options: "i" };
  const matchingOrgIds = eligibleOrgs
    .filter((org) => new RegExp(escapeRegex(term), "i").test(org.name))
    .map((org) => org._id);

  const or = [
    { name: regex },
    { code: regex },
    { "address.line1": regex },
    { "address.line2": regex },
    { "address.city": regex },
    { "address.postcode": regex },
    { "address.county": regex },
  ];

  if (matchingOrgIds.length) {
    or.unshift({ organizationId: { $in: matchingOrgIds } });
  }

  const branchMatch = {
    status: BranchStatus.ACTIVE,
    organizationId: { $in: eligibleOrgs.map((org) => org._id) },
    $or: or,
  };

  const { data, meta } = await paginateWithFacet({
    model: Branch,
    match: branchMatch,
    page,
    limit,
    skip,
    sort: { name: 1 },
    extraDataStages: [
      {
        $project: {
          _id: 1,
          organizationId: 1,
          name: 1,
          code: 1,
          address: 1,
          timezone: 1,
        },
      },
    ],
  });

  const mapped = data.map((branch) => {
    const org = orgById.get(String(branch.organizationId));
    return {
      branchId: branch._id,
      branchName: branch.name,
      branchCode: branch.code,
      organizationId: branch.organizationId,
      organizationName: org?.name || "",
      address: publicAddress(branch.address),
      timezone: branch.timezone,
    };
  });

  return { data: mapped, meta };
};

const shapeStaffPreview = async (profile) => {
  const [user, jobTitle, departments] = await Promise.all([
    User.findById(profile.userId).select("name email phoneNumber").lean(),
    JobTitle.findById(profile.jobTitleId).select("name level").lean(),
    Department.find({ _id: { $in: profile.departmentIds || [] } })
      .select("name")
      .lean(),
  ]);

  return {
    staffId: profile._id,
    employeeCode: profile.employeeCode,
    name: user?.name || "",
    email: user?.email || "",
    photoUrl: profile.photoUrl || "",
    jobTitle: jobTitle?.name || "",
    departments: departments.map((d) => d.name),
    branchId: profile.branchId,
    hasPin: Boolean(profile.pinHash),
    hasNfc: Boolean(profile.nfcTagId),
  };
};

const assertStaffAtKioskBranch = async ({
  staffId,
  organizationId,
  branchId,
}) => {
  const profile = await StaffProfile.findOne({
    _id: staffId,
    organizationId,
    branchId,
    status: StaffProfileStatus.ACTIVE,
  })
    .select("+pinHash")
    .lean();

  if (!profile) throw new AppError("staff_not_at_kiosk_branch", 403);
  return profile;
};

const searchStaffForKiosk = async ({
  organizationId,
  branchId,
  keyword,
  page,
  limit,
  skip,
}) => {
  const term = String(keyword ?? "").trim();
  if (term.length < MIN_SEARCH_LENGTH) {
    throw new AppError("kiosk_staff_search_term_too_short", 400);
  }

  const users = await User.find({
    $or: [
      { name: { $regex: escapeRegex(term), $options: "i" } },
      { email: { $regex: escapeRegex(term), $options: "i" } },
    ],
  })
    .select("_id")
    .lean();

  const match = {
    organizationId,
    branchId,
    status: StaffProfileStatus.ACTIVE,
    $or: [
      { employeeCode: { $regex: escapeRegex(term), $options: "i" } },
      { userId: { $in: users.map((u) => u._id) } },
    ],
  };

  const { data, meta } = await paginateWithFacet({
    model: StaffProfile,
    match,
    page,
    limit,
    skip,
    sort: { employeeCode: 1 },
    extraDataStages: [
      {
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "jobtitles",
          localField: "jobTitleId",
          foreignField: "_id",
          as: "jobTitle",
        },
      },
      { $unwind: { path: "$jobTitle", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 1,
          employeeCode: 1,
          photoUrl: 1,
          name: "$user.name",
          jobTitle: "$jobTitle.name",
        },
      },
    ],
  });

  const mapped = data.map((row) => ({
    staffId: row._id,
    employeeCode: row.employeeCode,
    name: row.name || "",
    photoUrl: row.photoUrl || "",
    jobTitle: row.jobTitle || "",
  }));

  return { data: mapped, meta };
};

const getStaffPreviewForKiosk = async ({
  organizationId,
  branchId,
  staffId,
}) => {
  const profile = await assertStaffAtKioskBranch({
    staffId,
    organizationId,
    branchId,
  });
  return shapeStaffPreview(profile);
};

const resolvePhoneForStaff = (profile, user) => {
  const phone = (profile.phone || user?.phoneNumber || "").trim();
  if (!phone) throw new AppError("staff_phone_not_found", 400);
  return phone;
};

const requestKioskCheckInOtp = async ({
  organizationId,
  branchId,
  staffId,
}) => {
  const profile = await assertStaffAtKioskBranch({
    staffId,
    organizationId,
    branchId,
  });

  const user = await User.findById(profile.userId).select(
    "phoneNumber otpInfo timezone accountState"
  );

  if (!user) throw new AppError("user_not", 404);
  if (["restricted", "suspended"].includes(user.accountState?.status)) {
    throw new AppError("your_account_4", 403);
  }

  const phoneNumber = resolvePhoneForStaff(profile, user);
  const otp = user.generateOtp("phoneNumber", user.timezone || "UTC");
  if (otp?.error === "too_many_otp_requests") {
    throw new AppError("too_many_otp_requests", 400);
  }

  await user.save();
  communicationService.sendSmsViaPinpointAws({ phoneNumber, otp }).catch(() => {});

  return {
    staffId: profile._id,
    phoneMasked: phoneNumber.replace(/.(?=.{4})/g, "*"),
    expiresInMinutes: 5,
  };
};

const verifyKioskCheckInOtp = async ({
  organizationId,
  branchId,
  kioskId,
  staffId,
  otp,
  clientEventId,
  occurredAt,
}) => {
  const profile = await assertStaffAtKioskBranch({
    staffId,
    organizationId,
    branchId,
  });

  const user = await User.findById(profile.userId).select(
    "otpInfo timezone phoneNumber"
  );
  if (!user) throw new AppError("user_not", 404);

  const userOtp = user.otpInfo?.phoneNumberOtp;
  if (!userOtp?.otp || userOtp.otp !== String(otp)) {
    throw new AppError("invalid_otp", 400);
  }

  const currentTime = moment.tz(Date.now(), user.timezone || "UTC").valueOf();
  if (userOtp.otpExpires && userOtp.otpExpires < currentTime) {
    throw new AppError("otp_has", 400);
  }

  userOtp.otp = "";
  userOtp.otpExpires = "";
  userOtp.otpUsed = true;
  await user.save();

  const attendance = await attendanceService.clockInForStaff({
    staffProfile: profile,
    organizationId,
    branchId,
    checkInMethod: CheckInMethod.PHONE,
    clientEventId,
    occurredAt,
  });

  touchLastCheckIn(kioskId);
  return attendance;
};

const randomScanToken = () => crypto.randomBytes(24).toString("hex");

const getKioskQr = async ({ kioskId }) => {
  const kiosk = await Kiosk.findById(kioskId).lean();
  if (!kiosk) throw new AppError("kiosk_not_found", 404);

  const now = Date.now();
  const stillValid =
    kiosk.scanToken &&
    kiosk.scanTokenExpiresAt &&
    new Date(kiosk.scanTokenExpiresAt).getTime() > now;

  let scanToken = kiosk.scanToken;
  let scanTokenExpiresAt = kiosk.scanTokenExpiresAt;

  if (!stillValid) {
    scanToken = randomScanToken();
    scanTokenExpiresAt = new Date(now + SCAN_TOKEN_TTL_MS);
    await Kiosk.updateOne(
      { _id: kioskId },
      { $set: { scanToken, scanTokenExpiresAt } }
    );
  }

  return {
    scanToken,
    expiresAt: scanTokenExpiresAt,
    qrPayload: `tempyhub://kiosk?token=${scanToken}`,
  };
};

const expireStalePairingSessions = async (kioskId) => {
  await KioskPairingSession.updateMany(
    {
      kioskId,
      status: KioskPairingStatus.PENDING_CONFIRMATION,
      expiresAt: { $lte: new Date() },
    },
    { $set: { status: KioskPairingStatus.EXPIRED } }
  );
};

const scanKioskFromPhone = async ({
  scanToken,
  userId,
  organizationId,
}) => {
  const kiosk = await Kiosk.findOne({
    scanToken: String(scanToken).trim(),
    scanTokenExpiresAt: { $gt: new Date() },
    setupStatus: KioskSetupStatus.REGISTERED,
  }).lean();

  if (!kiosk) throw new AppError("kiosk_scan_token_invalid", 400);

  const branch = await Branch.findById(kiosk.branchId)
    .select("organizationId status")
    .lean();
  if (!branch || branch.status !== BranchStatus.ACTIVE) {
    throw new AppError("branch_not_active", 403);
  }

  await assertAttendanceModule(branch.organizationId);

  if (String(branch.organizationId) !== String(organizationId)) {
    throw new AppError("no_membership_for_scope", 403);
  }

  const profile = await StaffProfile.findOne({
    userId,
    organizationId,
    branchId: kiosk.branchId,
    status: StaffProfileStatus.ACTIVE,
  })
    .select("+pinHash")
    .lean();

  if (!profile) throw new AppError("staff_not_at_kiosk_branch", 403);

  await expireStalePairingSessions(kiosk._id);

  await KioskPairingSession.updateMany(
    {
      kioskId: kiosk._id,
      status: KioskPairingStatus.PENDING_CONFIRMATION,
    },
    { $set: { status: KioskPairingStatus.CANCELLED } }
  );

  const session = await KioskPairingSession.create({
    kioskId: kiosk._id,
    branchId: kiosk.branchId,
    organizationId: branch.organizationId,
    staffId: profile._id,
    scanToken: kiosk.scanToken,
    status: KioskPairingStatus.PENDING_CONFIRMATION,
    expiresAt: new Date(Date.now() + PAIRING_SESSION_TTL_MS),
  });

  const preview = await shapeStaffPreview(profile);
  emitKioskPairingReady({ kioskId: kiosk._id, session });

  return {
    sessionId: session._id,
    kioskId: kiosk._id,
    branchId: kiosk.branchId,
    staff: preview,
  };
};

const getPendingPairing = async ({ kioskId }) => {
  await expireStalePairingSessions(kioskId);

  const session = await KioskPairingSession.findOne({
    kioskId,
    status: KioskPairingStatus.PENDING_CONFIRMATION,
    expiresAt: { $gt: new Date() },
  })
    .sort({ createdAt: -1 })
    .lean();

  if (!session) return { session: null, staff: null };

  const profile = await StaffProfile.findById(session.staffId)
    .select("+pinHash")
    .lean();
  if (!profile) return { session: null, staff: null };

  const staff = await shapeStaffPreview(profile);
  return {
    session: {
      sessionId: session._id,
      status: session.status,
      expiresAt: session.expiresAt,
    },
    staff,
  };
};

const confirmPairingAndClockIn = async ({
  kioskId,
  organizationId,
  branchId,
  sessionId,
  clientEventId,
  occurredAt,
}) => {
  const session = await KioskPairingSession.findOne({
    _id: sessionId,
    kioskId,
    status: KioskPairingStatus.PENDING_CONFIRMATION,
    expiresAt: { $gt: new Date() },
  }).lean();

  if (!session) throw new AppError("kiosk_pairing_not_found", 404);

  const profile = await assertStaffAtKioskBranch({
    staffId: session.staffId,
    organizationId,
    branchId,
  });

  const attendance = await attendanceService.clockInForStaff({
    staffProfile: profile,
    organizationId,
    branchId,
    checkInMethod: CheckInMethod.QR,
    clientEventId,
    occurredAt,
  });

  await KioskPairingSession.updateOne(
    { _id: session._id },
    {
      $set: {
        status: KioskPairingStatus.CONFIRMED,
        confirmedAt: new Date(),
      },
    }
  );

  touchLastCheckIn(kioskId);
  return attendance;
};

const cancelPairing = async ({ kioskId, sessionId }) => {
  const session = await KioskPairingSession.findOne({
    _id: sessionId,
    kioskId,
    status: KioskPairingStatus.PENDING_CONFIRMATION,
  });

  if (!session) throw new AppError("kiosk_pairing_not_found", 404);

  session.status = KioskPairingStatus.CANCELLED;
  await session.save();
  return { sessionId: session._id, status: session.status };
};

const assertAttendanceModule = async (organizationId) => {
  const organization = await Organization.findById(organizationId)
    .select("moduleAccess status")
    .lean();

  if (!organization) throw new AppError("organization_not_found", 404);
  if (organization.status !== OrganizationStatus.ACTIVE) {
    throw new AppError("organization_suspended", 403);
  }
  if (!isModuleEnabled(organization, ModuleSlug.SIGN_IN_ATTENDANCE)) {
    throw new AppError("module_not_enabled", 403, { module: ModuleSlug.SIGN_IN_ATTENDANCE });
  }

  return organization;
};

const sanitizeKiosk = (kiosk) => ({
  _id: kiosk._id,
  branchId: kiosk.branchId,
  deviceId: kiosk.deviceId || null,
  receptionIdentifier: kiosk.receptionIdentifier || "",
  locationLabel: kiosk.locationLabel || "",
  deviceType: kiosk.deviceType || null,
  nfcTagId: kiosk.nfcTagId || null,
  setupStatus: kiosk.setupStatus,
  kioskMode: kiosk.kioskMode,
  lastHeartbeatAt: kiosk.lastHeartbeatAt,
  lastCheckInAt: kiosk.lastCheckInAt,
  createdAt: kiosk.createdAt,
  updatedAt: kiosk.updatedAt,
});

const resolveStaffForKiosk = async ({
  organizationId,
  branchId,
  staffId,
  nfcTagId,
  employeeCode,
  pin,
}) => {
  const baseQuery = {
    organizationId,
    status: StaffProfileStatus.ACTIVE,
  };

  let profile;
  let checkInMethod = CheckInMethod.KIOSK;

  if (nfcTagId) {
    profile = await StaffProfile.findOne({
      ...baseQuery,
      nfcTagId: String(nfcTagId).trim(),
    }).lean();
    checkInMethod = CheckInMethod.NFC;
  } else if (employeeCode && pin !== undefined && pin !== null && String(pin) !== "") {
    profile = await StaffProfile.findOne({
      ...baseQuery,
      employeeCode: String(employeeCode).trim(),
    }).lean();

    if (
      !profile ||
      !profile.pinHash ||
      !(await bcrypt.compare(String(pin), profile.pinHash))
    ) {
      throw new AppError("staff_identification_failed", 401);
    }
  } else if (
    staffId &&
    pin !== undefined &&
    pin !== null &&
    String(pin) !== ""
  ) {
    profile = await StaffProfile.findOne({
      ...baseQuery,
      _id: staffId,
    }).lean();

    if (
      !profile ||
      !profile.pinHash ||
      !(await bcrypt.compare(String(pin), profile.pinHash))
    ) {
      throw new AppError("staff_identification_failed", 401);
    }
    checkInMethod = CheckInMethod.KIOSK;
  } else if (staffId && process.env.NODE_ENV !== "prod") {
    profile = await StaffProfile.findOne({
      ...baseQuery,
      _id: staffId,
    }).lean();
  } else {
    throw new AppError("staff_identification_required", 400);
  }

  if (!profile) throw new AppError("staff_identification_failed", 401);
  if (String(profile.branchId) !== String(branchId)) {
    throw new AppError("staff_not_at_kiosk_branch", 403);
  }

  return { profile, checkInMethod };
};

const registerKiosk = async ({
  branchId,
  activationCode,
  deviceId,
  adminPin,
  receptionIdentifier,
  locationLabel,
  deviceType,
}) => {
  const branch = await Branch.findById(branchId)
    .select("organizationId status")
    .lean();

  if (!branch) throw new AppError("branch_not_found", 404);
  if (branch.status !== BranchStatus.ACTIVE) {
    throw new AppError("branch_not_active", 403);
  }

  await assertAttendanceModule(branch.organizationId);

  if (!deviceId || !String(deviceId).trim()) {
    throw new AppError("kiosk_device_id_required", 400);
  }
  if (!/^\d{4,8}$/.test(String(adminPin))) {
    throw new AppError("invalid_kiosk_admin_pin", 400);
  }

  const type = parseDeviceType(deviceType);
  const trimmedDeviceId = String(deviceId).trim();
  const taken = await Kiosk.findOne({ deviceId: trimmedDeviceId }).lean();
  if (taken) throw new AppError("kiosk_device_already_registered", 409);

  const codeRecord = await verifyActivationCode({
    branchId,
    code: activationCode,
  });
  const adminPinHash = await bcrypt.hash(String(adminPin), 10);

  let kiosk;
  if (codeRecord.kioskId) {
    kiosk = await Kiosk.findOne({
      _id: codeRecord.kioskId,
      branchId,
    });
    if (!kiosk) throw new AppError("kiosk_not_found", 404);
    if (kiosk.setupStatus === KioskSetupStatus.REGISTERED && kiosk.deviceId) {
      throw new AppError("kiosk_device_already_registered", 409);
    }
    kiosk.deviceId = trimmedDeviceId;
    kiosk.adminPinHash = adminPinHash;
    kiosk.setupStatus = KioskSetupStatus.REGISTERED;
    kiosk.kioskMode = KioskMode.LOCKED;
    if (type) kiosk.deviceType = type;
    if (receptionIdentifier) kiosk.receptionIdentifier = receptionIdentifier;
    if (locationLabel) kiosk.locationLabel = locationLabel;
    await kiosk.save();
  } else {
    kiosk = await Kiosk.create({
      branchId,
      deviceId: trimmedDeviceId,
      adminPinHash,
      receptionIdentifier: receptionIdentifier || "",
      locationLabel: locationLabel || "",
      ...(type ? { deviceType: type } : {}),
      setupStatus: KioskSetupStatus.REGISTERED,
      kioskMode: KioskMode.LOCKED,
    });
  }

  if (codeRecord._id) {
    await BranchActivationCode.updateOne(
      { _id: codeRecord._id },
      { $set: { usedByKioskId: kiosk._id } }
    );
  }

  return {
    token: signKioskToken(kiosk),
    kiosk: sanitizeKiosk(kiosk),
  };
};

const assertKioskUnlocked = async (kioskOrId) => {
  const kiosk =
    kioskOrId && kioskOrId.kioskMode !== undefined
      ? kioskOrId
      : await Kiosk.findById(kioskOrId).select("kioskMode").lean();
  if (!kiosk) throw new AppError("kiosk_not_found", 404);
  if (kiosk.kioskMode === KioskMode.LOCKED) {
    throw new AppError("kiosk_locked", 403);
  }
};

const getKioskSession = async ({ kiosk, branch }) => ({
  kiosk: sanitizeKiosk(kiosk),
  branch: {
    _id: branch._id,
    name: branch.name,
    timezone: branch.timezone,
  },
});

const touchLastCheckIn = (kioskId) =>
  Kiosk.updateOne({ _id: kioskId }, { $set: { lastCheckInAt: new Date() } }).catch(
    () => {}
  );

const clockInAtKiosk = async ({
  organizationId,
  branchId,
  kioskId,
  staffId,
  nfcTagId,
  employeeCode,
  pin,
  clientEventId,
  occurredAt,
}) => {
  await assertKioskUnlocked(kioskId);
  const { profile, checkInMethod } = await resolveStaffForKiosk({
    organizationId,
    branchId,
    staffId,
    nfcTagId,
    employeeCode,
    pin,
  });

  const attendance = await attendanceService.clockInForStaff({
    staffProfile: profile,
    organizationId,
    branchId,
    checkInMethod,
    clientEventId,
    occurredAt,
  });

  touchLastCheckIn(kioskId);
  return attendance;
};

const clockOutAtKiosk = async ({
  organizationId,
  branchId,
  kioskId,
  staffId,
  nfcTagId,
  employeeCode,
  pin,
  clientEventId,
  occurredAt,
}) => {
  await assertKioskUnlocked(kioskId);
  const { profile } = await resolveStaffForKiosk({
    organizationId,
    branchId,
    staffId,
    nfcTagId,
    employeeCode,
    pin,
  });

  const attendance = await attendanceService.clockOutForStaff({
    staffProfile: profile,
    branchId,
    clientEventId,
    occurredAt,
  });

  touchLastCheckIn(kioskId);
  return attendance;
};

const listOnSiteAtKiosk = async ({ branchId, keyword, page, limit, skip }) =>
  attendanceService.listOnSiteForBranch({
    branchId,
    keyword,
    page,
    limit,
    skip,
  });

const getTodayAtKiosk = async ({
  organizationId,
  branchId,
  staffId,
  nfcTagId,
  employeeCode,
  pin,
}) => {
  const { profile } = await resolveStaffForKiosk({
    organizationId,
    branchId,
    staffId,
    nfcTagId,
    employeeCode,
    pin,
  });

  return attendanceService.getTodayAttendanceForStaff({
    staffProfile: profile,
    organizationId,
    branchId,
  });
};

/** Heartbeat younger than this is treated as online on the admin list. */
const HEARTBEAT_ONLINE_MS = 2 * 60 * 1000;

const parseSetupStatus = (value) => {
  if (value == null || value === "") return undefined;
  if (!Object.values(KioskSetupStatus).includes(value)) {
    throw new AppError("invalid_kiosk_setup_status", 400);
  }
  return value;
};

const parseDeviceType = (value) => {
  if (value == null || value === "") return undefined;
  const type = String(value).trim().toLowerCase();
  if (!Object.values(KioskDeviceType).includes(type)) {
    throw new AppError("invalid_kiosk_device_type", 400);
  }
  return type;
};

const parseKioskMode = (value) => {
  if (value == null || value === "") return undefined;
  if (!Object.values(KioskMode).includes(value)) {
    throw new AppError("invalid_kiosk_mode", 400);
  }
  return value;
};

const parsePresence = (value) => {
  if (value == null || value === "") return undefined;
  const presence = String(value).trim().toLowerCase();
  if (presence !== "online" && presence !== "offline") {
    throw new AppError("invalid_kiosk_presence", 400);
  }
  return presence;
};

const heartbeatCutoff = () => new Date(Date.now() - HEARTBEAT_ONLINE_MS);

const applyPresenceMatch = (match, presence) => {
  if (!presence) return;
  const cutoff = heartbeatCutoff();
  if (presence === "online") {
    match.lastHeartbeatAt = { $gte: cutoff };
    return;
  }
  const offline = {
    $or: [{ lastHeartbeatAt: null }, { lastHeartbeatAt: { $lt: cutoff } }],
  };
  if (match.$or) {
    match.$and = [{ $or: match.$or }, offline];
    delete match.$or;
    return;
  }
  Object.assign(match, offline);
};

const orgBranchIds = async ({ actor, organizationId, branchId }) => {
  const standing = await actorStanding(actor, organizationId);
  const scopedBranchId = scopeBranchFilter(standing, branchId);
  assertMayManageStaff(standing, scopedBranchId);

  const branchFilter = { organizationId };
  if (scopedBranchId) {
    await assertBranchInOrganization(scopedBranchId, organizationId);
    branchFilter._id = scopedBranchId;
  }

  const branches = await Branch.find(branchFilter).select("_id").lean();
  return branches.map((row) => row._id);
};

const kioskListStages = () => [
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
      presence: {
        $cond: [
          { $gte: ["$lastHeartbeatAt", heartbeatCutoff()] },
          "online",
          "offline",
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
  {
    $project: {
      adminPinHash: 0,
      scanToken: 0,
      scanTokenExpiresAt: 0,
      _branch: 0,
    },
  },
];

const branchPublic = (branch) => {
  if (!branch) return null;
  const settings = branch.settings || {};
  return {
    _id: branch._id,
    name: branch.name,
    code: branch.code,
    timezone: branch.timezone,
    settings: {
      enableBreaks: Boolean(settings.enableBreaks),
      paidBreaks: Boolean(settings.paidBreaks),
      allowPhoneCheckIn: Boolean(settings.allowPhoneCheckIn),
      lateGraceMinutes: settings.lateGraceMinutes ?? 5,
      enableLeaveRequests: settings.enableLeaveRequests !== false,
    },
  };
};

const shapeAdminKiosk = (kiosk, branch) => {
  const lastHeartbeatAt = kiosk.lastHeartbeatAt;
  const site = branchPublic(branch);
  return {
    ...sanitizeKiosk(kiosk),
    presence:
      lastHeartbeatAt && lastHeartbeatAt >= heartbeatCutoff()
        ? "online"
        : "offline",
    branch: site
      ? {
          _id: site._id,
          name: site.name,
          code: site.code,
          ...(branch.timezone !== undefined || branch.settings
            ? { timezone: site.timezone, settings: site.settings }
            : {}),
        }
      : null,
  };
};

const emptyKioskList = (page, limit) => ({
  data: [],
  meta: {
    currentPage: page,
    totalPages: 0,
    totalRecords: 0,
    limit,
    total: 0,
    online: 0,
    offline: 0,
    locked: 0,
    pending: 0,
  },
});

const listKiosksForAdmin = async ({
  actor,
  organizationId,
  page,
  limit,
  skip,
  branchId,
  keyword,
  setupStatus,
  kioskMode,
  presence,
  deviceType,
}) => {
  const branchIds = await orgBranchIds({ actor, organizationId, branchId });
  if (!branchIds.length) return emptyKioskList(page, limit);

  const match = { branchId: { $in: branchIds } };
  const countMatch = { branchId: { $in: branchIds } };

  const or = keywordOr(
    keyword,
    ["deviceId", "receptionIdentifier", "locationLabel"],
    { trim: true }
  );
  if (or) {
    match.$or = or;
    countMatch.$or = or;
  }

  const setup = parseSetupStatus(setupStatus);
  if (setup) match.setupStatus = setup;
  const mode = parseKioskMode(kioskMode);
  if (mode) match.kioskMode = mode;
  const type = parseDeviceType(deviceType);
  if (type) match.deviceType = type;
  applyPresenceMatch(match, parsePresence(presence));

  const cutoff = heartbeatCutoff();
  const { data, meta, result } = await paginateWithFacet({
    model: Kiosk,
    match,
    page,
    limit,
    skip,
    extraDataStages: kioskListStages(),
    extraFacets: {
      allCount: [{ $match: countMatch }, { $count: "count" }],
      onlineCount: [
        { $match: { ...countMatch, lastHeartbeatAt: { $gte: cutoff } } },
        { $count: "count" },
      ],
      lockedCount: [
        { $match: { ...countMatch, kioskMode: KioskMode.LOCKED } },
        { $count: "count" },
      ],
      pendingCount: [
        {
          $match: { ...countMatch, setupStatus: KioskSetupStatus.PENDING },
        },
        { $count: "count" },
      ],
    },
  });

  const total = facetCount(result.allCount);
  const online = facetCount(result.onlineCount);
  return {
    data,
    meta: {
      ...meta,
      total,
      online,
      offline: Math.max(0, total - online),
      locked: facetCount(result.lockedCount),
      pending: facetCount(result.pendingCount),
    },
  };
};

const loadKioskVisitDetail = async (kioskId) => {
  const [row] = await VisitSession.aggregate([
    { $match: { kioskId } },
    {
      $facet: {
        onSite: [
          { $match: { status: VisitSessionStatus.ON_SITE } },
          { $count: "count" },
        ],
        checkIns: [
          { $match: { checkInAt: { $ne: null } } },
          { $count: "count" },
        ],
        checkOuts: [
          { $match: { checkOutAt: { $ne: null } } },
          { $count: "count" },
        ],
        recent: [
          { $sort: { createdAt: -1 } },
          { $limit: 10 },
          {
            $lookup: {
              from: ExternalPerson.collection.name,
              localField: "externalPersonId",
              foreignField: "_id",
              as: "_person",
            },
          },
          {
            $addFields: {
              _personDoc: { $arrayElemAt: ["$_person", 0] },
            },
          },
          {
            $project: {
              _id: 1,
              name: { $ifNull: ["$_personDoc.name", ""] },
              personType: 1,
              method: 1,
              status: 1,
              purposeOfVisit: 1,
              arrivedAt: 1,
              checkInAt: 1,
              checkOutAt: 1,
            },
          },
        ],
      },
    },
  ]);

  return {
    visitorsOnSite: facetCount(row?.onSite),
    visitorCheckIns: facetCount(row?.checkIns),
    visitorCheckOuts: facetCount(row?.checkOuts),
    recentVisits: row?.recent || [],
  };
};

const getKioskForAdmin = async ({ actor, organizationId, kioskId }) => {
  const kiosk = await Kiosk.findById(kioskId).lean();
  if (!kiosk) throw new AppError("kiosk_not_found", 404);

  await assertBranchInOrganization(kiosk.branchId, organizationId);
  const standing = await actorStanding(actor, organizationId);
  const scoped = scopeBranchFilter(standing, kiosk.branchId);
  if (scoped && String(scoped) !== String(kiosk.branchId)) {
    throw new AppError("outside_managed_branch", 403);
  }
  assertMayManageStaff(standing, kiosk.branchId);

  const [branch, visits] = await Promise.all([
    Branch.findById(kiosk.branchId)
      .select("_id name code timezone settings")
      .lean(),
    loadKioskVisitDetail(kiosk._id),
  ]);

  return {
    ...shapeAdminKiosk(kiosk, branch),
    ...visits,
  };
};

const createKioskForAdmin = async ({
  actor,
  organizationId,
  branchId,
  receptionIdentifier,
  locationLabel,
  deviceType,
}) => {
  if (!receptionIdentifier || !String(receptionIdentifier).trim()) {
    throw new AppError("kiosk_name_required", 400);
  }
  await orgBranchIds({ actor, organizationId, branchId });
  await assertBranchInOrganization(branchId, organizationId);
  await assertAttendanceModule(organizationId);

  const type = parseDeviceType(deviceType);
  const kiosk = await Kiosk.create({
    branchId,
    receptionIdentifier: String(receptionIdentifier).trim(),
    locationLabel: locationLabel ? String(locationLabel).trim() : "",
    ...(type ? { deviceType: type } : {}),
    setupStatus: KioskSetupStatus.PENDING,
    kioskMode: KioskMode.SETUP,
  });

  const issued = await issueActivationCode({
    branchId,
    organizationId,
    issuedByUserId: actor._id,
    kioskId: kiosk._id,
  });

  const branch = await Branch.findById(branchId)
    .select("_id name code timezone settings")
    .lean();

  return {
    ...shapeAdminKiosk(kiosk.toObject(), branch),
    code: issued.code,
    expiresAt: issued.expiresAt,
  };
};

const updateKioskForAdmin = async ({
  actor,
  organizationId,
  kioskId,
  receptionIdentifier,
  locationLabel,
  deviceType,
  branchId,
}) => {
  const current = await getKioskForAdmin({ actor, organizationId, kioskId });
  const update = {};
  if (receptionIdentifier !== undefined) {
    if (!String(receptionIdentifier).trim()) {
      throw new AppError("kiosk_name_required", 400);
    }
    update.receptionIdentifier = String(receptionIdentifier).trim();
  }
  if (locationLabel !== undefined) {
    update.locationLabel = String(locationLabel).trim();
  }
  if (deviceType !== undefined) {
    const type = parseDeviceType(deviceType);
    if (!type) throw new AppError("invalid_kiosk_device_type", 400);
    update.deviceType = type;
  }
  if (branchId !== undefined) {
    await orgBranchIds({ actor, organizationId, branchId });
    await assertBranchInOrganization(branchId, organizationId);
    update.branchId = branchId;
  }
  if (!Object.keys(update).length) throw new AppError("nothing_to_update", 400);

  const saved = await Kiosk.findByIdAndUpdate(
    kioskId,
    { $set: update },
    { new: true, runValidators: true }
  ).lean();
  if (!saved) throw new AppError("kiosk_not_found", 404);

  const branch = await Branch.findById(saved.branchId)
    .select("_id name code timezone settings")
    .lean();
  return { ...shapeAdminKiosk(saved, branch), visitorsOnSite: current.visitorsOnSite };
};

const toggleKioskLockForAdmin = async ({ actor, organizationId, kioskId }) => {
  await getKioskForAdmin({ actor, organizationId, kioskId });
  const current = await Kiosk.findById(kioskId).select("branchId kioskMode").lean();
  if (!current) throw new AppError("kiosk_not_found", 404);

  const nextMode =
    current.kioskMode === KioskMode.LOCKED ? KioskMode.SETUP : KioskMode.LOCKED;

  const saved = await Kiosk.findByIdAndUpdate(
    kioskId,
    { $set: { kioskMode: nextMode } },
    { new: true, runValidators: true }
  ).lean();
  const branch = await Branch.findById(saved.branchId)
    .select("_id name code timezone settings")
    .lean();
  return shapeAdminKiosk(saved, branch);
};

module.exports = {
  searchBranchesForKiosk,
  searchStaffForKiosk,
  getStaffPreviewForKiosk,
  requestKioskCheckInOtp,
  verifyKioskCheckInOtp,
  getKioskQr,
  scanKioskFromPhone,
  getPendingPairing,
  confirmPairingAndClockIn,
  cancelPairing,
  registerKiosk,
  getKioskSession,
  clockInAtKiosk,
  clockOutAtKiosk,
  getTodayAtKiosk,
  listOnSiteAtKiosk,
  listKiosksForAdmin,
  getKioskForAdmin,
  createKioskForAdmin,
  updateKioskForAdmin,
  toggleKioskLockForAdmin,
  assertAttendanceModule,
};
