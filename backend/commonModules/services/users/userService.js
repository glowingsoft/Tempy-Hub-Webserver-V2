const moment = require("moment");
const mongoose = require("mongoose");
const validator = require("validator");
const fs = require("fs");
const path = require("path");
const { User, SubscriptionType } = require("@models/UserModel");
const Review = require("@models/Review");
const { StaffProfile } = require("@models/StaffProfile");
const { Branch } = require("@models/Branch");
const { JobTitle } = require("@models/JobTitle");
const { Department } = require("@models/Department");
const { Organization } = require("@models/Organization");
const { StaffProfileStatus } = require("@models/domainEnums");
const { formatUserResponse } = require("@utils/userResponseUtil");
const { userCache } = require("@config/nodeCache");
const { AppError } = require("@services/_errors/AppError");

const populationFields = {};

let currenciesData = null;
try {
  const currenciesFilePath = path.join(
    __dirname,
    "../../../assets/currencies/currencies.json"
  );
  if (fs.existsSync(currenciesFilePath)) {
    currenciesData = JSON.parse(fs.readFileSync(currenciesFilePath, "utf8"));
  }
} catch {
  currenciesData = null;
}

const blockUser = async ({ currentUserId, userIdToBlock }) => {
  if (String(currentUserId) === String(userIdToBlock)) {
    throw new AppError("you_cannot", 400);
  }

  const [currentUser, userToBlock] = await Promise.all([
    User.findById(currentUserId).select("blockedUsers"),
    User.findById(userIdToBlock),
  ]);

  if (!userToBlock) {
    throw new AppError("user_to_1", 404);
  }

  if (currentUser.blockedUsers.includes(userIdToBlock)) {
    throw new AppError("user_is", 400);
  }

  currentUser.blockedUsers.push(userIdToBlock);
  await currentUser.save();
};

const reportUser = async ({ currentUserId, userIdToReport }) => {
  if (String(currentUserId) === String(userIdToReport)) {
    throw new AppError("you_cannot_1", 400);
  }

  const userToReport = await User.findById(userIdToReport);
  if (!userToReport) {
    throw new AppError("user_to_2", 404);
  }

  if (userToReport.reportedBy.includes(currentUserId)) {
    throw new AppError("you_have", 400);
  }

  userToReport.reportedBy.push(currentUserId);
  userToReport.reportCount += 1;

  if (userToReport.reportCount >= 10) {
    userToReport.accountState.status = "suspended";
    userToReport.accountState.reason =
      "User suspended due to multiple reports.";
    userToReport.accountState.suspensionDate = new Date();
  }

  await userToReport.save();
};

const addOrUpdateSubscription = async ({ userId, type }) => {
  if (!Object.values(SubscriptionType).includes(type)) {
    const validSubscriptionTypes = Object.values(SubscriptionType);
    throw new AppError(
      "Invalid subscription type. Valid types are: " +
        validSubscriptionTypes.join(", "),
      400
    );
  }

  const user = await User.findById(userId).select("subscriptions");
  const existingSubscription = user.subscriptions.find(
    (sub) => sub.type === type
  );

  if (existingSubscription) {
    if (type === SubscriptionType.PLAN2) {
      existingSubscription.endDate = moment(existingSubscription.endDate)
        .add(1, "month")
        .toDate();
    } else if (type === SubscriptionType.PLAN3) {
      existingSubscription.endDate = moment(existingSubscription.endDate)
        .add(1, "year")
        .toDate();
    }
  } else {
    let endDate = null;
    if (type === SubscriptionType.PLAN2) {
      endDate = moment().add(1, "month").toDate();
    } else if (type === SubscriptionType.PLAN3) {
      endDate = moment().add(1, "year").toDate();
    }

    user.subscriptions.push({
      type,
      startDate: new Date(),
      endDate,
    });
  }

  await user.save();
  return user.subscriptions;
};

const removeSubscription = async ({ userId, subscriptionId }) => {
  const user = await User.findById(userId).select("subscriptions");
  const subscriptionIndex = user.subscriptions.findIndex(
    (sub) => sub._id.toString() === subscriptionId
  );
  if (subscriptionIndex === -1) {
    throw new AppError("subscription_not", 404);
  }

  user.subscriptions.splice(subscriptionIndex, 1);
  await user.save();
};

const getSubscriptions = async ({ userId }) => {
  const user = await User.findById(userId).select("subscriptions");
  const subscriptions = user.subscriptions;

  if (
    subscriptions.length === 1 &&
    subscriptions[0].type === SubscriptionType.PLAN1
  ) {
    subscriptions[0].isActive = true;
  } else {
    const activeSubscriptions = subscriptions.filter((sub) => {
      return (
        sub.endDate &&
        moment(sub.endDate).isAfter(moment()) &&
        sub.type !== SubscriptionType.PLAN1
      );
    });

    if (activeSubscriptions.length > 0) {
      const maxExpirySubscription = activeSubscriptions.reduce(
        (maxSub, currentSub) => {
          return moment(currentSub.endDate).isAfter(moment(maxSub.endDate))
            ? currentSub
            : maxSub;
        }
      );

      subscriptions.forEach((sub) => {
        sub.isActive = sub._id.equals(maxExpirySubscription._id);
      });
    }
  }

  return subscriptions.map((sub) => ({
    ...sub.toObject(),
    isActive: sub.isActive,
  }));
};

const getUserWithPopulatedFields = async (userId, fieldsToPopulate = []) => {
  try {
    let query = User.findById(userId);
    fieldsToPopulate.forEach((field) => {
      const populationConfig = populationFields[field];
      if (populationConfig) {
        query = query.populate(populationConfig.path, populationConfig.select);
      }
    });
    return await query.exec();
  } catch (error) {
    console.error("Error fetching user:", error);
    throw new AppError("User fetch error", 500);
  }
};

const staffCardFromRow = (profile, { branch, jobTitle, departments, organization }) => ({
    ...profile,
    organization: organization
      ? {
          _id: organization._id,
          name: organization.name,
          status: organization.status,
        }
      : null,
    branch: branch
      ? {
          _id: branch._id,
          name: branch.name,
          code: branch.code,
          status: branch.status,
          timezone: branch.timezone,
        }
      : null,
    jobTitle: jobTitle
      ? { _id: jobTitle._id, name: jobTitle.name, level: jobTitle.level }
      : null,
    departments: (departments || []).map((d) => ({
      _id: d._id,
      name: d.name,
      branchId: d.branchId || null,
    })),
});

const loadStaffCardsForUser = async (userId, organizationId) => {
  const match = {
    userId,
    status: StaffProfileStatus.ACTIVE,
  };
  if (organizationId && mongoose.Types.ObjectId.isValid(organizationId)) {
    match.organizationId = organizationId;
  }

  const profiles = await StaffProfile.find(match).select("-pinHash").lean();
  if (!profiles.length) return [];

  const orgIds = [...new Set(profiles.map((p) => String(p.organizationId)))];
  const branchIds = [...new Set(profiles.map((p) => String(p.branchId)))];
  const jobTitleIds = profiles.map((p) => p.jobTitleId).filter(Boolean);
  const departmentIds = [
    ...new Set(profiles.flatMap((p) => (p.departmentIds || []).map(String))),
  ];

  const [organizations, branches, jobTitles, departments] = await Promise.all([
    Organization.find({ _id: { $in: orgIds } }).select("name status").lean(),
    Branch.find({ _id: { $in: branchIds } })
      .select("name code status timezone")
      .lean(),
    jobTitleIds.length
      ? JobTitle.find({ _id: { $in: jobTitleIds } }).select("name level").lean()
      : [],
    departmentIds.length
      ? Department.find({ _id: { $in: departmentIds } })
          .select("name branchId")
          .lean()
      : [],
  ]);

  const orgById = new Map(organizations.map((o) => [String(o._id), o]));
  const branchById = new Map(branches.map((b) => [String(b._id), b]));
  const jobById = new Map(jobTitles.map((j) => [String(j._id), j]));
  const deptById = new Map(departments.map((d) => [String(d._id), d]));

  return profiles.map((profile) =>
    staffCardFromRow(profile, {
      organization: orgById.get(String(profile.organizationId)),
      branch: branchById.get(String(profile.branchId)),
      jobTitle: profile.jobTitleId
        ? jobById.get(String(profile.jobTitleId))
        : null,
      departments: (profile.departmentIds || [])
        .map((id) => deptById.get(String(id)))
        .filter(Boolean),
    })
  );
};

const loadStaffCard = async (userId, organizationId) => {
  if (!organizationId || !mongoose.Types.ObjectId.isValid(organizationId)) {
    return undefined;
  }
  const [card] = await loadStaffCardsForUser(userId, organizationId);
  return card || null;
};

const withStaffCard = async (payload, userId, organizationId) => {
  if (!organizationId) return payload;
  payload.staffProfile = await loadStaffCard(userId, organizationId);
  return payload;
};

const getUserProfile = async ({
  userId,
  fieldsToPopulate = [],
  organizationId,
}) => {
  let query = User.findById(userId);
  if (fieldsToPopulate.length > 0) {
    fieldsToPopulate.forEach((field) => {
      const populationConfig = populationFields[field];
      if (populationConfig) {
        query = query.populate(populationConfig.path, populationConfig.select);
      }
    });
  }

  const user = await query.exec();
  if (!user) {
    throw new AppError("user_not", 404);
  }

  return withStaffCard(
    formatUserResponse(user, null, [], ["resetToken"]),
    userId,
    organizationId
  );
};

const getOtherUserProfile = async ({ userId }) => {
  const [user, recentReviews] = await Promise.all([
    User.findById(userId).select(
      "profileIcon name phoneNumber verificationStatus.phoneNumber"
    ),
    Review.find({ object: userId, reviewType: "user" })
      .sort({ createdAt: -1 })
      .limit(5)
      .populate("subject", "name profileIcon"),
  ]);

  if (!user) {
    throw new AppError("user_not", 404);
  }

  const response = formatUserResponse(
    user,
    null,
    [],
    ["resetToken", "accountState", "metadata"]
  );

  response.contactInfo = {
    phoneNumber: user.phoneNumber,
    verificationStatus: user.verificationStatus.phoneNumber,
  };
  response.recentReviews = recentReviews;

  return response;
};

const updateUserProfile = async ({
  userId,
  name,
  profileIcon,
  phoneNumber,
  location,
  distanceUnit,
  currencySymbol,
  currencyCode,
  allowCurrencyUpdate = false,
  organizationId,
}) => {
  const user = await User.findById(userId);
  if (!user) {
    throw new AppError("user_not", 404);
  }

  if (profileIcon) {
    user.profileIcon = profileIcon;
  }

  if (distanceUnit) {
    user.distanceUnit = distanceUnit;
  }

  if (allowCurrencyUpdate && currencySymbol && currencyCode) {
    if (currenciesData === null) {
      throw new AppError("currency_list_error", 500);
    }
    const currency = currenciesData.find(
      (c) => c.symbol === currencySymbol && c.code === currencyCode
    );
    if (!currency) {
      throw new AppError("invalid_currency", 400);
    }
    user.currencySymbol = currencySymbol;
    user.currencyCode = currencyCode;
  }

  if (name && name.trim() !== "") user.name = name;
  if (phoneNumber) {
    if (!validator.isMobilePhone(phoneNumber)) {
      throw new AppError("invalid_phone_1", 400);
    }
    user.phoneNumber = phoneNumber;
  }

  if (location) {
    const { coordinates, fullAddress } = location;
    if (!coordinates || coordinates.length !== 2 || !fullAddress) {
      throw new AppError("invalid_location_1", 400);
    }
    const [longitude, latitude] = coordinates;
    if (typeof longitude !== "number" || typeof latitude !== "number") {
      throw new AppError("invalid_coordinates", 400);
    }
    user.location = {
      type: "Point",
      coordinates: [longitude, latitude],
      fullAddress,
    };
  }

  await user.save();
  userCache.del(userId.toString());

  if (organizationId && mongoose.Types.ObjectId.isValid(organizationId)) {
    const staffUpdate = {};
    if (phoneNumber) staffUpdate.phone = phoneNumber;
    if (profileIcon) staffUpdate.photoUrl = profileIcon;
    if (Object.keys(staffUpdate).length) {
      await StaffProfile.updateOne(
        {
          userId,
          organizationId,
          status: StaffProfileStatus.ACTIVE,
        },
        { $set: staffUpdate }
      );
    }
  }

  return withStaffCard(
    formatUserResponse(user, null, [], ["resetToken"]),
    userId,
    organizationId
  );
};

const listAllUsers = async () => {
  return User.find({}).sort({ createdAt: -1 }).lean();
};

module.exports = {
  blockUser,
  reportUser,
  addOrUpdateSubscription,
  removeSubscription,
  getSubscriptions,
  getUserWithPopulatedFields,
  getUserProfile,
  getOtherUserProfile,
  updateUserProfile,
  listAllUsers,
  loadStaffCardsForUser,
  loadStaffCard,
  SubscriptionType,
};
