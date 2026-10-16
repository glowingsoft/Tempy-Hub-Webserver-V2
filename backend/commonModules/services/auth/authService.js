const { User, generateResetToken } = require("@models/UserModel");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const moment = require("moment-timezone");
const { formatUserResponse } = require("@utils/userResponseUtil");
const {
  registrationOtpEmailTemplate,
  forgotPasswordOtpEmailTemplate,
} = require("@utils/emailTemplates");
const { createOrSkipDevice, Devices } = require("@models/Devices");
const validator = require("validator");
const { AppError } = require("@services/_errors/AppError");
const { Membership } = require("@models/Membership");
const { Organization } = require("@models/Organization");
const { Resident } = require("@models/Resident");
const { ExternalPerson } = require("@models/ExternalPerson");
const { StaffProfile } = require("@models/StaffProfile");
const { ModuleDefinition } = require("@models/ModuleDefinition");
const {
  effectivePermissions,
  modulesForMenu,
  platformAdminModuleMenu,
} = require("@adminServices/organizations/permissionCatalogue");
const {
  AuthAudience,
  ActiveInactiveStatus,
  MembershipRole,
} = require("@models/domainEnums");
const { assertSurfaceAccess } = require("./surfaceAccess");

const register = async ({
  email,
  phoneNumber,
  deviceId,
  deviceType,
  userType,
  profileIcon,
  name,
  password,
  timezone,
  location,
  adminAccessToken,
  body = {},
}) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    if (
      phoneNumber &&
      !validator.isMobilePhone(phoneNumber, "any", { strictMode: true })
    ) {
      throw new AppError("invalid_phone", 400);
    }

    const existingEmail = await User.findOne({
      email: email.trim().toLowerCase(),
    });

    const existingPhone = await User.findOne({
      phoneNumber: phoneNumber.trim().toLowerCase(),
      "verificationStatus.phoneNumber": "verified",
    });

    if (existingEmail) {
      if (
        (existingEmail.email === email.trim().toLowerCase(),
        existingEmail.verificationStatus.email === "verified")
      ) {
        throw new AppError("email_already", 409);
      }
    }

    if (existingPhone) {
      if (existingPhone.phoneNumber === phoneNumber.trim().toLowerCase()) {
        throw new AppError("phone_number_already", 409);
      }
    }

    let existingUser = existingEmail;

    let finalUserType = "user";
    if (userType === "admin") {
      if (adminAccessToken === process.env.ADMIN_ACCESS_TOKEN) {
        finalUserType = "admin";
      } else {
        throw new AppError("unauthorized_to", 403);
      }
    }

    let user;
    if (existingUser) {
      existingUser.verificationStatus.email = "pending";
      existingUser.verificationStatus.phoneNumber = "pending";
      user = existingUser;
      Object.assign(user, body);
      user.accountState.userType = finalUserType;
    } else {
      user = new User({
        email,
        phoneNumber,
        deviceId,
        deviceType,
        profileIcon,
        name,
        password,
        timezone,
        location,
        accountState: { userType: finalUserType },
      });
    }

    const otp = user.generateOtp("email", user.timezone);

    await user.save({ session });

    const subject = "Welcome! Verify Your Email";
    const mBody = registrationOtpEmailTemplate(otp);
    //await sendEmailViaBrevo([email], subject, mBody);

    await session.commitTransaction();

    const response = formatUserResponse(user);

    createOrSkipDevice(user._id, deviceId, deviceType);

    return response;
  } catch (error) {
    await session.abortTransaction();
    if (error instanceof AppError) throw error;
    if (error.name === "ValidationError") {
      throw new AppError(Object.values(error.errors)[0].message, 400);
    }
    throw new AppError(error.message, 500);
  } finally {
    session.endSession();
  }
};

/** Most privileged first; used to pick a default surface for the client. */
const ROLE_PRECEDENCE = [
  MembershipRole.SUPER_ADMIN,
  MembershipRole.OWNER,
  MembershipRole.SITE_MANAGER,
  MembershipRole.LINE_MANAGER,
  MembershipRole.STAFF,
];

const highestRoleOf = (memberships = []) =>
  ROLE_PRECEDENCE.find((role) => memberships.some((m) => m.role === role)) ||
  null;

/**
 * Resolves what a staff-audience account may actually do.
 *
 * A platform admin (`accountState.userType === "admin"`) is deliberately allowed
 * through without a Membership: the first superAdmin has to be able to sign in
 * before any organization exists, otherwise creating one is a deadlock.
 */
const resolveStaffAccess = async (user) => {
  const isPlatformAdmin = user.accountState?.userType === "admin";

  const rows = await Membership.find({
    userId: user._id,
    status: ActiveInactiveStatus.ACTIVE,
  })
    .select("organizationId branchId role permissions")
    .lean();

  // An owner holds no stored permissions — the role answers every check — so the
  // client is given the list it implies, or it would render an owner as having
  // no access at all.
  const organizations = await Organization.find({
    _id: { $in: rows.map((row) => row.organizationId) },
  })
    .select("moduleAccess name status")
    .lean();

  const byOrganization = new Map(
    organizations.map((org) => [String(org._id), org])
  );

  const definitions = await ModuleDefinition.find({ active: true })
    .select("slug name")
    .lean();
  const moduleNameBySlug = new Map(definitions.map((d) => [d.slug, d.name]));

  const now = new Date();
  const moduleAccess = {};
  const organizationSummaries = organizations.map(({ _id, name, status, moduleAccess: entitlements }) => {
    moduleAccess[String(_id)] = (entitlements || [])
      .filter(
        (m) => m.enabled && (!m.expiresAt || new Date(m.expiresAt) > now)
      )
      .map((m) => m.moduleSlug);

    return { _id, name, status };
  });

  const memberships = rows.map((row) => {
    const organization = byOrganization.get(String(row.organizationId));
    const permissionKeys = effectivePermissions(row, organization);

    return {
      ...row,
      organizationName: organization?.name || "",
      permissions: permissionKeys,
      assignedPermissions: row.permissions || [],
      modules: modulesForMenu(permissionKeys, moduleNameBySlug),
    };
  });

  const highestRole = isPlatformAdmin
    ? MembershipRole.SUPER_ADMIN
    : highestRoleOf(memberships);

  const isAdminSurface =
    isPlatformAdmin ||
    highestRole === MembershipRole.SUPER_ADMIN ||
    highestRole === MembershipRole.OWNER;

  const modules =
    isPlatformAdmin && !memberships.length
      ? platformAdminModuleMenu(moduleNameBySlug)
      : memberships.length === 1
        ? memberships[0].modules
        : undefined;

  return {
    isPlatformAdmin,
    memberships,
    highestRole,
    defaultSurface: isAdminSurface ? "adminWeb" : "staffApp",
    /** Convenience when the account belongs to a single organization. */
    modules,
    /** Per-organization module menu; use the entry matching the active org scope. */
    moduleMenu: Object.fromEntries(
      memberships.map((m) => [String(m.organizationId), m.modules])
    ),
    /** Org-level entitlements (licensed modules), keyed by organizationId. */
    moduleAccess,
    organizations: organizationSummaries,
  };
};

const emptyStaffAccessFields = () => ({
  moduleMenu: {},
  moduleAccess: {},
  organizations: [],
  modules: undefined,
});

/**
 * A single login serves every surface, so we confirm the account actually exists
 * on the surface it is asking for before minting a token for that audience.
 */
const assertAudienceAccess = async (user, audience) => {
  const userId = user._id;

  if (audience === AuthAudience.STAFF) {
    const access = await resolveStaffAccess(user);

    if (!access.isPlatformAdmin && !access.memberships.length) {
      throw new AppError("no_membership_for_scope", 403);
    }

    return access;
  }

  if (audience === AuthAudience.RESIDENT) {
    const resident = await Resident.exists({ userId });
    if (!resident) {
      throw new AppError("resident_profile_not_found", 403);
    }
    return {
      isPlatformAdmin: false,
      memberships: [],
      highestRole: null,
      defaultSurface: "residentApp",
      ...emptyStaffAccessFields(),
    };
  }

  if (audience === AuthAudience.VISITOR) {
    const person = await ExternalPerson.exists({ userId });
    if (!person) {
      throw new AppError("visitor_profile_not_found", 403);
    }
    return {
      isPlatformAdmin: false,
      memberships: [],
      highestRole: null,
      defaultSurface: "visitorApp",
      ...emptyStaffAccessFields(),
    };
  }

  throw new AppError("wrong_token_audience", 400);
};

const login = async ({
  email,
  password,
  deviceId,
  deviceType,
  timezone,
  audience = AuthAudience.STAFF,
  surface,
  adminAccessToken,
}) => {
  const user = await User.findByCredentials(email, password);

  if (user.error) {
    if (user.error === "user_not_found") {
      throw new AppError("user_not_found", 404);
    } else if (user.error === "incorrect_password") {
      throw new AppError("incorrect_password", 401);
    }
  }

  if (user.accountState.userType === "admin") {
    if (!adminAccessToken) {
      throw new AppError("admin_access_token_missing", 403);
    }
    if (adminAccessToken !== process.env.ADMIN_ACCESS_TOKEN) {
      throw new AppError("admin_access_token_invalid", 403);
    }
  }

  const verificationStatus = user.verificationStatus["email"];
  if (verificationStatus === "pending") {
    throw new AppError("your_account", 401);
  }

  if (verificationStatus === "rejected") {
    throw new AppError("your_account_1", 403);
  }

  if (
    user.accountState.status === "restricted" ||
    user.accountState.status === "suspended"
  ) {
    throw new AppError("your_account_2", 403);
  }

  if (verificationStatus !== "verified") {
    throw new AppError("your_account_3", 401);
  }

  const access = await assertAudienceAccess(user, audience);
  assertSurfaceAccess({ surface, audience, access });

  user.timezone = timezone;

  const token = user.generateAuthToken(audience, surface);

  const response = formatUserResponse(user, token, [], ["resetToken"]);
  response.audience = audience;
  response.surface = surface || null;
  // Without this the client cannot tell an owner from a staff member, since the
  // rest of the payload is identical for every account.
  response.access = access;

  createOrSkipDevice(user._id, deviceId, deviceType);

  return response;
};

const generateOtp = async ({ email, phoneNumber, type }) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    if (
      type === "phoneNumber" &&
      phoneNumber &&
      !validator.isMobilePhone(phoneNumber, "any", { strictMode: true })
    ) {
      throw new AppError("invalid_phone", 400);
    }

    let user;
    if (type === "email") {
      user = await User.findOne({ email: email.toLowerCase() }).select(
        "email accountState otpInfo"
      );
    } else if (type === "phoneNumber") {
      user = await User.findOne({ phoneNumber }).select(
        "phoneNumber accountState otpInfo"
      );
    }

    if (!user) {
      throw new AppError("user_not", 404);
    }

    if (["restricted", "suspended"].includes(user.accountState.status)) {
      throw new AppError("your_account_4", 403);
    }

    const otp = user.generateOtp(type, user.timezone);

    if (otp.error) {
      if (otp.error === "too_many_otp_requests") {
        throw new AppError("too_many_otp_requests", 400);
      }
    }

    await user.save({ session });

    const subject = "Password Reset OTP";
    const mBody = forgotPasswordOtpEmailTemplate(otp);
    //await sendEmailViaBrevo([email], subject, mBody);

    await session.commitTransaction();

    return { otp };
  } catch (error) {
    await session.abortTransaction();
    if (error instanceof AppError) throw error;
    throw new AppError(error.message, 500);
  } finally {
    session.endSession();
  }
};

const verifyOtp = async ({ email, phoneNumber, type, otp }) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    if (
      type === "phoneNumber" &&
      phoneNumber &&
      !validator.isMobilePhone(phoneNumber, "any", { strictMode: true })
    ) {
      throw new AppError("invalid_phone", 400);
    }

    let user;
    if (type === "email") {
      user = await User.findOne({ email: email.toLowerCase() }).select(
        "email accountState otpInfo verificationStatus timezone"
      );
    } else if (type === "phoneNumber") {
      user = await User.findOne({ phoneNumber }).select(
        "phoneNumber accountState otpInfo verificationStatus timezone"
      );
    }

    if (!user) {
      throw new AppError("user_not", 404);
    }

    const userOtpInfo =
      type === "email" ? user.otpInfo.emailOtp : user.otpInfo.phoneNumberOtp;

    if (type === "email") {
      if (userOtpInfo.otp !== otp.toString()) {
        throw new AppError("invalid_otp", 400);
      }

      const currentTime = moment.tz(Date.now(), user.timezone).valueOf();
      if (userOtpInfo.otpExpires && userOtpInfo.otpExpires < currentTime) {
        throw new AppError("otp_has", 400);
      }
    }

    userOtpInfo.otp = "";
    userOtpInfo.otpExpires = "";
    userOtpInfo.otpUsed = true;
    user.verificationStatus[type] = "verified";

    const resetToken = generateResetToken();
    user.resetToken = resetToken;

    await user.save({ session });
    await session.commitTransaction();

    const updatedUser = await User.findById(user._id);

    const token = user.generateAuthToken();

    return formatUserResponse(updatedUser, token);
  } catch (error) {
    await session.abortTransaction();
    if (error instanceof AppError) throw error;
    throw new AppError("an_error", 500);
  } finally {
    session.endSession();
  }
};

const resetPassword = async ({ email, newPassword, resetToken }) => {
  const user = await User.findOne({
    email: email.trim().toLowerCase(),
    resetToken: resetToken,
  });

  if (!user) {
    throw new AppError("no_valid", 400);
  }

  user.password = newPassword;
  user.otpInfo.otpUsed = true;
  user.otpInfo.otp = "";
  user.otpInfo.otpExpires = "";
  user.resetToken = "";

  await user.save();

  const [updatedUser, token] = await Promise.all([
    User.findById(user._id),
    user.generateAuthToken(),
  ]);

  return formatUserResponse(updatedUser, token);
};

const changePassword = async ({ userId, oldPassword, newPassword }) => {
  if (oldPassword === newPassword) {
    throw new AppError("password_same_as_old", 400);
  }

  const user = await User.findById(userId);
  if (!user) throw new AppError("user_not", 404);

  const matches = await bcrypt.compare(oldPassword, user.password || "");
  if (!matches) throw new AppError("incorrect_password", 400);

  user.password = newPassword;
  user.resetToken = "";
  await user.save();
};

const logout = async ({ userId, deviceId }) => {
  await Devices.updateOne(
    { userId: userId },
    { $pull: { devices: { deviceId: deviceId } } }
  );
};

const deleteAccount = async ({ userId, email }) => {
  const randomEmail = `deleted_user_${userId}_${Date.now()}@example.com`;

  await User.findByIdAndUpdate(
    userId,
    {
      $set: {
        email: randomEmail,
        previousEmail: email,
        "accountState.status": "hardDeleted",
        "accountState.finalDeletionDate": new Date(),
      },
    },
    { new: true }
  );

  await Devices.updateOne({ userId: userId }, { $set: { devices: [] } });
};

const socialAuth = async ({
  provider,
  socialId,
  email,
  name,
  deviceId,
  deviceType,
  timezone,
}) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const existingUser = await User.findOne({ email });

    if (existingUser) {
      if (
        existingUser.accountState.status === "restricted" ||
        existingUser.accountState.status === "suspended"
      ) {
        throw new AppError("your_account_2", 403);
      }

      if (provider === "google" && !existingUser.googleId) {
        existingUser.googleId = socialId;
      } else if (provider === "facebook" && !existingUser.facebookId) {
        existingUser.facebookId = socialId;
      } else if (provider === "apple" && !existingUser.appleId) {
        existingUser.appleId = socialId;
      }

      existingUser.provider = provider;
      existingUser.timezone = timezone;
      existingUser.accountState.status = "active";

      await existingUser.save({ session });
      const token = existingUser.generateAuthToken();

      const response = formatUserResponse(existingUser, token);

      createOrSkipDevice(existingUser._id, deviceId, deviceType);

      await session.commitTransaction();

      return {
        statusCode: 200,
        translationKey: "login_success",
        data: response,
      };
    }

    const newUser = new User({
      email,
      name,
      provider,
      [`${provider}Id`]: socialId,
      timezone,
      verificationStatus: {
        email: "verified",
      },
    });

    await newUser.save({ session });

    const token = newUser.generateAuthToken();

    const response = formatUserResponse(newUser, token);

    createOrSkipDevice(newUser._id, deviceId, deviceType);

    await session.commitTransaction();

    return {
      statusCode: 201,
      translationKey: "signup_successful",
      data: response,
    };
  } catch (error) {
    await session.abortTransaction();
    if (error instanceof AppError) throw error;
    throw new AppError(error.message, 500);
  } finally {
    session.endSession();
  }
};

/**
 * Everything a client needs on boot: the account, its scopes, and which
 * sellable modules are live for each organization it can act in.
 */
const me = async ({ userId, audience = AuthAudience.STAFF }) => {
  const user = await User.findById(userId);

  if (!user) {
    throw new AppError("user_not", 404);
  }

  const profile = formatUserResponse(user, null, [], ["resetToken"]);

  if (audience !== AuthAudience.STAFF) {
    return {
      user: profile,
      audience,
      access: {
        isPlatformAdmin: false,
        memberships: [],
        highestRole: null,
        defaultSurface:
          audience === AuthAudience.RESIDENT ? "residentApp" : "visitorApp",
        ...emptyStaffAccessFields(),
      },
    };
  }

  const access = await resolveStaffAccess(user);

  const staffProfiles = await StaffProfile.find({ userId })
    .select("_id branchId organizationId employeeCode jobTitleId reportsToStaffId")
    .lean();

  const profileIds = staffProfiles.map((p) => p._id);
  const directReports = profileIds.length
    ? await StaffProfile.countDocuments({ reportsToStaffId: { $in: profileIds } })
    : 0;

  return {
    user: profile,
    audience,
    access,
    staffProfile: staffProfiles[0] || null,
    staffProfiles,
    hasDirectReports: directReports > 0,
  };
};

module.exports = {
  register,
  login,
  me,
  generateOtp,
  verifyOtp,
  resetPassword,
  changePassword,
  logout,
  deleteAccount,
  socialAuth,
};
