const { User } = require("@models/UserModel");
const { Devices } = require("@models/Devices");
const Review = require("@models/Review");
const SupportRequest = require("@models/SupportRequest");
const ContactUs = require("@models/ContactUs");
const Faq = require("@models/Faq");
const { generateMeta } = require("@utils/responseUtil");
const {
  paginateWithFacet,
  keywordOr,
  facetCount,
} = require("@utils/paginate");
const { AppError } = require("@services/_errors/AppError");
const { regionSwitchBranches } = require("./regionMapping");

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const getDashboard = async () => {
  const [userCounts] = await User.aggregate([
    {
      $facet: {
        active: [
          { $match: { "accountState.status": "active" } },
          { $count: "count" },
        ],
        inactive: [
          { $match: { "accountState.status": "inactive" } },
          { $count: "count" },
        ],
        pendingDocuments: [
          { $match: { "verificationStatus.documents": "submitted" } },
          { $count: "count" },
        ],
      },
    },
  ]);

  const [deviceCounts] = await Devices.aggregate([
    {
      $facet: {
        android: [
          { $match: { "devices.deviceType": "android" } },
          { $count: "count" },
        ],
        ios: [
          { $match: { "devices.deviceType": "ios" } },
          { $count: "count" },
        ],
      },
    },
  ]);

  const androidCount = facetCount(deviceCounts.android);
  const iosCount = facetCount(deviceCounts.ios);

  // Booking / Listing collections are not in this codebase; keep response shape.
  return {
    activeUsersCount: facetCount(userCounts.active),
    inactiveUsersCount: facetCount(userCounts.inactive),
    bookingsCount: 0,
    listingsCount: 0,
    pendingDocumentsCount: facetCount(userCounts.pendingDocuments),
    listingDamageRequestsCount: 0,
    appDownloadsCount: {
      android: androidCount,
      ios: iosCount,
      total: androidCount + iosCount,
    },
  };
};

const getUserStatsByRegion = async ({ year }) => {
  const branches = regionSwitchBranches();

  const pipeline = [
    {
      $match: {
        "accountState.status": "active",
        createdAt: {
          $gte: new Date(`${year}-01-01T00:00:00.000Z`),
          $lt: new Date(`${year + 1}-01-01T00:00:00.000Z`),
        },
      },
    },
    {
      $addFields: {
        region: {
          $switch: {
            branches,
            default: "Other",
          },
        },
      },
    },
    {
      $group: {
        _id: {
          region: "$region",
          month: { $month: "$createdAt" },
        },
        userCount: { $sum: 1 },
      },
    },
    {
      $group: {
        _id: "$_id.region",
        monthlyData: {
          $push: {
            month: "$_id.month",
            count: "$userCount",
          },
        },
      },
    },
    {
      $project: {
        _id: 0,
        region: "$_id",
        monthlyData: {
          $map: {
            input: { $range: [1, 13] },
            as: "month",
            in: {
              month: "$$month",
              count: {
                $reduce: {
                  input: {
                    $filter: {
                      input: "$monthlyData",
                      as: "data",
                      cond: { $eq: ["$$data.month", "$$month"] },
                    },
                  },
                  initialValue: 0,
                  in: { $add: ["$$value", "$$this.count"] },
                },
              },
            },
          },
        },
      },
    },
  ];

  const [userStatsResult, availableYearsResult] = await Promise.allSettled([
    User.aggregate(pipeline),
    User.distinct("createdAt").then((dates) => [
      ...new Set(dates.map((date) => new Date(date).getFullYear())),
    ]),
  ]);

  const userStats =
    userStatsResult.status === "fulfilled" ? userStatsResult.value : [];
  const availableYears =
    availableYearsResult.status === "fulfilled"
      ? availableYearsResult.value
      : [];

  const stats = userStats.map((regionData) => ({
    region: regionData.region,
    data: regionData.monthlyData.map((data) => data.count),
  }));

  return {
    stats,
    months: MONTHS,
    year,
    availableYears,
  };
};

const getTopRatedUsers = async () => {
  return Review.find({ reviewType: "user" })
    .populate({
      path: "object",
      model: "User",
      select: "name email profileIcon",
    })
    .sort({ rating: -1 })
    .limit(10);
};

const listUsers = async ({ page, limit, skip, status, keyword }) => {
  const queryConditions = {
    "accountState.status": { $in: ["active", "inactive"] },
    "accountState.userType": { $ne: "admin" },
  };
  if (status) {
    queryConditions["accountState.status"] = status;
  }

  const or = keywordOr(keyword, ["name", "email", "phoneNumber"], {
    trim: true,
  });
  if (or) {
    queryConditions.$or = or;
  }

  const nonAdmin = { "accountState.userType": { $ne: "admin" } };

  const { data, meta, result } = await paginateWithFacet({
    model: User,
    match: queryConditions,
    page,
    limit,
    skip,
    extraDataStages: [
      {
        $project: {
          name: 1,
          email: 1,
          profileIcon: 1,
          phoneNumber: 1,
          "accountState.status": 1,
        },
      },
    ],
    extraFacets: {
      allUsers: [
        {
          $match: {
            ...nonAdmin,
            "accountState.status": { $in: ["active", "inactive", "suspended"] },
          },
        },
        { $count: "count" },
      ],
      allActiveUsers: [
        { $match: { ...nonAdmin, "accountState.status": "active" } },
        { $count: "count" },
      ],
      allInactiveUsers: [
        { $match: { ...nonAdmin, "accountState.status": "inactive" } },
        { $count: "count" },
      ],
      allSuspendedUsers: [
        { $match: { ...nonAdmin, "accountState.status": "suspended" } },
        { $count: "count" },
      ],
    },
  });

  meta.usersCount = {
    total: facetCount(result.allUsers),
    active: facetCount(result.allActiveUsers),
    inactive: facetCount(result.allInactiveUsers),
    suspended: facetCount(result.allSuspendedUsers),
  };

  return { data, meta };
};

const getSupportRequests = async ({
  page,
  limit,
  skip,
  keyword,
  status,
  applyLimit,
}) => {
  const queryConditions = {};
  if (status) {
    queryConditions.status = status;
  }
  const or = keywordOr(keyword, ["name", "email", "subject", "message"]);
  if (or) {
    queryConditions.$or = or;
  }

  const { data, meta, result } = await paginateWithFacet({
    model: SupportRequest,
    match: queryConditions,
    page,
    limit,
    skip,
    applyLimit,
    extraFacets: {
      totalPending: [{ $match: { status: "pending" } }, { $count: "count" }],
      totalResponded: [
        { $match: { status: "responded" } },
        { $count: "count" },
      ],
      totalResolved: [{ $match: { status: "resolved" } }, { $count: "count" }],
      totalClosed: [{ $match: { status: "closed" } }, { $count: "count" }],
      totalDocs: [{ $count: "count" }],
    },
  });

  meta.requestsCount = {
    totalDocs: facetCount(result.totalDocs),
    totalPending: facetCount(result.totalPending),
    totalResponded: facetCount(result.totalResponded),
    totalResolved: facetCount(result.totalResolved),
    totalClosed: facetCount(result.totalClosed),
  };

  return { data, meta };
};

const updateSupportRequestStatus = async ({ id, status }) => {
  const supportRequest = await SupportRequest.findById(id);
  if (!supportRequest) {
    throw new AppError("support_request_1", 404);
  }

  supportRequest.status = status;
  await supportRequest.save();
  return supportRequest;
};

const deleteSupportRequest = async ({ id }) => {
  const supportRequest = await SupportRequest.findById(id);
  if (!supportRequest) {
    throw new AppError("support_request_1", 404);
  }

  await supportRequest.deleteOne();
};

const getContactRequests = async ({
  page,
  limit,
  skip,
  keyword,
  status,
  applyLimit,
}) => {
  const queryConditions = {};
  if (status) {
    queryConditions.status = status;
  }
  const or = keywordOr(keyword, [
    "name",
    "email",
    "phoneNumber",
    "description",
  ]);
  if (or) {
    queryConditions.$or = or;
  }

  const { data, meta, result } = await paginateWithFacet({
    model: ContactUs,
    match: queryConditions,
    page,
    limit,
    skip,
    applyLimit,
    extraFacets: {
      totalPending: [{ $match: { status: "pending" } }, { $count: "count" }],
      totalResponded: [
        { $match: { status: "responded" } },
        { $count: "count" },
      ],
      totalResolved: [{ $match: { status: "resolved" } }, { $count: "count" }],
      totalClosed: [{ $match: { status: "closed" } }, { $count: "count" }],
      totalDocs: [{ $count: "count" }],
    },
  });

  meta.requestsCount = {
    totalDocs: facetCount(result.totalDocs),
    pending: facetCount(result.totalPending),
    responded: facetCount(result.totalResponded),
    resolved: facetCount(result.totalResolved),
    closed: facetCount(result.totalClosed),
  };

  return { data, meta };
};

const updateContactRequestStatus = async ({ id, status }) => {
  const contactRequest = await ContactUs.findById(id);
  if (!contactRequest) {
    throw new AppError("contact_request_1", 404);
  }

  contactRequest.status = status;
  await contactRequest.save();
  return contactRequest;
};

const deleteContactRequest = async ({ id }) => {
  const contactRequest = await ContactUs.findById(id);
  if (!contactRequest) {
    throw new AppError("contact_request_1", 404);
  }

  await contactRequest.deleteOne();
};

const getFaqs = async ({ page, limit, skip, keyword }) => {
  const queryConditions = {};
  const or = keywordOr(keyword, ["question", "answer"], { trim: true });
  if (or) {
    queryConditions.$or = or;
  }

  return paginateWithFacet({
    model: Faq,
    match: queryConditions,
    page,
    limit,
    skip,
  });
};

const createFaq = async ({ question, answer }) => {
  const faq = new Faq({ question, answer });
  await faq.save();
  return faq;
};

const updateFaq = async ({ id, question, answer }) => {
  const faq = await Faq.findById(id);
  if (!faq) {
    throw new AppError("Faq not found", 404);
  }

  faq.question = question;
  faq.answer = answer;
  await faq.save();
  return faq;
};

const deleteFaq = async ({ id }) => {
  const faq = await Faq.findById(id);
  if (!faq) {
    throw new AppError("Faq not found", 404);
  }

  await faq.deleteOne();
};

const updateUserAccountState = async ({ userId, status }) => {
  const user = await User.findById(userId);
  if (!user) {
    throw new AppError("user_not", 404);
  }

  user.accountState.status = status;
  await user.save();
};

module.exports = {
  getDashboard,
  getUserStatsByRegion,
  getTopRatedUsers,
  listUsers,
  getSupportRequests,
  updateSupportRequestStatus,
  deleteSupportRequest,
  getContactRequests,
  updateContactRequestStatus,
  deleteContactRequest,
  getFaqs,
  createFaq,
  updateFaq,
  deleteFaq,
  updateUserAccountState,
};
