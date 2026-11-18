const {
  Announcement,
  AnnouncementAudience,
  ANNOUNCEMENT_AUDIENCE,
  MAX_SUBJECT_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_CATEGORY_LENGTH,
} = require("@models/Announcement");
const { StaffProfile } = require("@models/StaffProfile");
const { Membership } = require("@models/Membership");
const { Department } = require("@models/Department");
const { Branch } = require("@models/Branch");
const { User } = require("@models/UserModel");
const { toPublicImageUrl } = require("@utils/imageHelper");
const { NotificationExp, NotificationTypes } = require("@models/Notifications");
const {
  StaffProfileStatus,
  ActiveInactiveStatus,
} = require("@models/domainEnums");
const { paginateWithFacet } = require("@utils/paginate");
const { AppError } = require("@services/_errors/AppError");
const {
  resolveLiveBranchId,
  loadDepartments,
} = require("@adminServices/siteLive/siteLiveService");
const {
  actorStanding,
  assertMayAccessResidents,
} = require("@adminServices/residents/residentAccess");
const {
  scopeBranchFilter,
  assertBranchInOrganization,
} = require("@adminServices/staff/staffAccess");
const {
  toObjectId,
  isValidObjectId,
} = require("@appServices/family/familyPipeline");

const ALL_STAFF = "All Staff";
const DEFAULT_AUDIENCE = [AnnouncementAudience.STAFF];
const AUDIENCE_ORDER = [
  AnnouncementAudience.SITE_MANAGER,
  AnnouncementAudience.LINE_MANAGER,
  AnnouncementAudience.STAFF,
];
const AUDIENCE_LABEL = {
  [AnnouncementAudience.SITE_MANAGER]: "Site Managers",
  [AnnouncementAudience.LINE_MANAGER]: "Line Managers",
  [AnnouncementAudience.STAFF]: "Staff",
};
const NOTIFY_CHUNK = 500;
const PREVIEW_LENGTH = 140;
const REMIND_COOLDOWN_MS = 60 * 60 * 1000;

const cleanText = (value, max, key, { required = true } = {}) => {
  const text = typeof value === "string" ? value.trim() : "";
  if ((required && !text) || text.length > max)
    throw new AppError(key, 400, { max });
  return text;
};

const cleanDepartmentIds = async ({ value, organizationId, siteId }) => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new AppError("invalid_department_id", 400);
  const ids = [...new Set(value.map(String))];
  const departments = await loadDepartments(organizationId, [siteId]);
  const known = new Set(
    departments.map((department) => String(department._id)),
  );
  if (!ids.every((id) => isValidObjectId(id) && known.has(id)))
    throw new AppError("invalid_department_id", 400);
  return ids.map(toObjectId);
};

const cleanAudience = (value) => {
  if (value === undefined || value === null) return [...DEFAULT_AUDIENCE];
  if (!Array.isArray(value) || !value.length)
    throw new AppError("invalid_announcement_audience", 400);
  const roles = [...new Set(value.map(String))];
  if (!roles.every((role) => ANNOUNCEMENT_AUDIENCE.includes(role)))
    throw new AppError("invalid_announcement_audience", 400);
  return AUDIENCE_ORDER.filter((role) => roles.includes(role));
};

const userIdsOf = (rows) =>
  rows
    .map((row) => row.userId || row._id)
    .filter(Boolean)
    .map((id) => String(id));

const loadRecipients = async ({
  organizationId,
  siteId,
  actorId,
  audience,
  departments,
}) => {
  const orgId = toObjectId(organizationId);
  const exclude = [toObjectId(actorId), null];
  const ids = new Set();

  const managerRoles = audience.filter(
    (role) => role !== AnnouncementAudience.STAFF,
  );
  if (managerRoles.length) {
    const managers = await Membership.find({
      organizationId: orgId,
      branchId: siteId,
      status: ActiveInactiveStatus.ACTIVE,
      role: { $in: managerRoles },
      userId: { $nin: exclude },
    })
      .select("userId")
      .lean();
    userIdsOf(managers).forEach((id) => ids.add(id));
  }

  if (audience.includes(AnnouncementAudience.STAFF)) {
    const staff = await StaffProfile.aggregate([
      {
        $match: {
          organizationId: orgId,
          branchId: siteId,
          status: StaffProfileStatus.ACTIVE,
          userId: { $nin: exclude },
          ...(departments.length
            ? { departmentIds: { $in: departments } }
            : {}),
        },
      },
      { $group: { _id: "$userId" } },
    ]);
    userIdsOf(staff).forEach((id) => ids.add(id));
  }

  return [...ids].map(toObjectId);
};

const createdByOf = (user) => {
  const userId = user?._id || user?.userId;
  if (!userId) return null;
  return {
    userId,
    name: user.name || "",
    email: user.email || "",
    photoUrl: toPublicImageUrl(user.photoUrl || user.profileIcon) || "",
  };
};

const createdByLookup = [
  {
    $lookup: {
      from: User.collection.name,
      localField: "createdBy",
      foreignField: "_id",
      as: "createdByUser",
    },
  },
  { $unwind: { path: "$createdByUser", preserveNullAndEmptyArrays: true } },
];

const createdByProject = {
  userId: "$createdByUser._id",
  name: { $ifNull: ["$createdByUser.name", ""] },
  email: { $ifNull: ["$createdByUser.email", ""] },
  photoUrl: { $ifNull: ["$createdByUser.profileIcon", ""] },
};

const countWhere = (field) => ({
  $size: {
    $filter: {
      input: "$recipients",
      as: "recipient",
      cond: { $ne: [`$$recipient.${field}`, null] },
    },
  },
});

const recipientUsersLookup = {
  $lookup: {
    from: User.collection.name,
    localField: "recipients.userId",
    foreignField: "_id",
    as: "recipientUsers",
  },
};

const peopleProject = {
  $map: {
    input: "$recipients",
    as: "recipient",
    in: {
      $let: {
        vars: {
          user: {
            $arrayElemAt: [
              {
                $filter: {
                  input: "$recipientUsers",
                  as: "user",
                  cond: { $eq: ["$$user._id", "$$recipient.userId"] },
                },
              },
              0,
            ],
          },
        },
        in: {
          userId: "$$recipient.userId",
          name: { $ifNull: ["$$user.name", ""] },
          email: { $ifNull: ["$$user.email", ""] },
          photoUrl: { $ifNull: ["$$user.profileIcon", ""] },
          seen: { $ne: ["$$recipient.seenAt", null] },
          acknowledged: { $ne: ["$$recipient.acknowledgedAt", null] },
          seenAt: "$$recipient.seenAt",
          acknowledgedAt: "$$recipient.acknowledgedAt",
        },
      },
    },
  },
};

const branchNameStages = [
  {
    $lookup: {
      from: Branch.collection.name,
      localField: "branchId",
      foreignField: "_id",
      as: "branch",
    },
  },
  {
    $addFields: {
      branchName: { $ifNull: [{ $arrayElemAt: ["$branch.name", 0] }, ""] },
    },
  },
];

const cardStagesOf = ({ detail = false } = {}) => [
  {
    $lookup: {
      from: Department.collection.name,
      localField: "departmentIds",
      foreignField: "_id",
      as: "departments",
    },
  },
  ...branchNameStages,
  ...(detail ? [recipientUsersLookup] : []),
  ...createdByLookup,
  {
    $project: {
      _id: 1,
      branchId: 1,
      branchName: 1,
      subject: 1,
      category: 1,
      createdAt: 1,
      createdBy: createdByProject,
      departments: "$departments.name",
      audience: 1,
      recipients: { $size: "$recipients" },
      seen: countWhere("seenAt"),
      acknowledged: countWhere("acknowledgedAt"),
      ...(detail
        ? { description: 1, remindedAt: 1, people: peopleProject }
        : {}),
    },
  },
];

const cardStages = cardStagesOf();

const audienceLabelOf = (roles, departmentNames) => {
  const ordered = AUDIENCE_ORDER.filter((role) => roles.includes(role));
  const names = [...departmentNames].sort();
  if (ordered.length === 1 && ordered[0] === AnnouncementAudience.STAFF) {
    return names.length ? names.join(", ") : ALL_STAFF;
  }
  const rolePart = ordered.map((role) => AUDIENCE_LABEL[role]).join(", ");
  if (names.length && ordered.includes(AnnouncementAudience.STAFF)) {
    return `${rolePart} (${names.join(", ")})`;
  }
  return rolePart;
};

const cardOf = ({ departments = [], audience, people, createdBy, ...row }) => {
  const roles =
    Array.isArray(audience) && audience.length
      ? AUDIENCE_ORDER.filter((role) => audience.includes(role))
      : [...DEFAULT_AUDIENCE];
  return {
    ...row,
    audience: roles,
    audienceLabel: audienceLabelOf(roles, departments),
    allAcknowledged: row.recipients > 0 && row.acknowledged === row.recipients,
    createdBy: createdByOf(createdBy),
    ...(people
      ? {
          people: people.map((person) => ({
            ...person,
            photoUrl: toPublicImageUrl(person.photoUrl) || "",
          })),
        }
      : {}),
  };
};

const notify = async ({ receivers, announcementId, actorId, title, text }) => {
  try {
    const body =
      text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH)}…` : text;
    for (let i = 0; i < receivers.length; i += NOTIFY_CHUNK) {
      await NotificationExp.insertMany(
        receivers.slice(i, i + NOTIFY_CHUNK).map((receiverId) => ({
          type: NotificationTypes.ANNOUNCEMENT,
          subjectId: actorId,
          objectId: announcementId,
          objectType: "announcement",
          receiverId,
          title,
          body,
        })),
        { ordered: false },
      );
    }
  } catch (error) {
    console.error("announcement notification failed", error.message);
  }
};

const createAnnouncement = async ({
  actor,
  organizationId,
  branchId,
  subject,
  description,
  category,
  departmentIds,
  audience: audienceInput,
}) => {
  const cleaned = {
    subject: cleanText(
      subject,
      MAX_SUBJECT_LENGTH,
      "invalid_announcement_subject",
    ),
    description: cleanText(
      description,
      MAX_DESCRIPTION_LENGTH,
      "invalid_announcement_description",
    ),
    category: cleanText(
      category,
      MAX_CATEGORY_LENGTH,
      "invalid_announcement_category",
      { required: false },
    ),
  };
  const siteId = toObjectId(
    await resolveLiveBranchId({ actor, organizationId, branchId }),
  );
  const branch = await Branch.findById(siteId).select("name").lean();
  const audience = cleanAudience(audienceInput);
  const departments = await cleanDepartmentIds({
    value: departmentIds,
    organizationId,
    siteId,
  });
  if (departments.length && !audience.includes(AnnouncementAudience.STAFF)) {
    throw new AppError("invalid_announcement_departments", 400);
  }

  const receivers = await loadRecipients({
    organizationId,
    siteId,
    actorId: actor._id,
    audience,
    departments,
  });
  if (!receivers.length) throw new AppError("announcement_no_recipients", 400);

  const created = await Announcement.create({
    organizationId: toObjectId(organizationId),
    branchId: siteId,
    createdBy: actor._id,
    ...cleaned,
    audience,
    departmentIds: departments,
    recipients: receivers.map((userId) => ({ userId })),
  });
  await notify({
    receivers,
    announcementId: created._id,
    actorId: actor._id,
    title: cleaned.subject,
    text: cleaned.description,
  });

  const names = (await loadDepartments(organizationId, [siteId]))
    .filter((department) =>
      departments.some((id) => String(id) === String(department._id)),
    )
    .map((department) => department.name);
  return cardOf({
    _id: created._id,
    branchId: created.branchId,
    branchName: branch?.name || "",
    subject: created.subject,
    category: created.category,
    createdAt: created.createdAt,
    createdBy: actor,
    audience,
    departments: names,
    recipients: receivers.length,
    seen: 0,
    acknowledged: 0,
  });
};

const listAnnouncements = async ({
  actor,
  organizationId,
  branchId,
  page,
  limit,
  skip,
}) => {
  const standing = await actorStanding(actor, organizationId);
  const scopedBranchId = scopeBranchFilter(standing, branchId);
  if (scopedBranchId) {
    await assertBranchInOrganization(scopedBranchId, organizationId);
  }

  const match = { organizationId: toObjectId(organizationId) };
  if (scopedBranchId) match.branchId = toObjectId(scopedBranchId);

  const { result, data, meta } = await paginateWithFacet({
    model: Announcement,
    match,
    page,
    limit,
    skip,
    sort: { createdAt: -1, _id: -1 },
    extraDataStages: cardStages,
    extraFacets: {
      readState: [
        { $match: match },
        { $unwind: "$recipients" },
        {
          $group: {
            _id: null,
            read: {
              $sum: { $cond: [{ $ne: ["$recipients.seenAt", null] }, 1, 0] },
            },
            unread: {
              $sum: { $cond: [{ $eq: ["$recipients.seenAt", null] }, 1, 0] },
            },
          },
        },
      ],
    },
  });
  const readState = result.readState?.[0] || { read: 0, unread: 0 };
  return {
    data: data.map(cardOf),
    meta: { ...meta, read: readState.read, unread: readState.unread },
  };
};

const getAnnouncement = async ({ actor, organizationId, announcementId }) => {
  if (!isValidObjectId(announcementId))
    throw new AppError("announcement_not_found", 404);
  const [row] = await Announcement.aggregate([
    {
      $match: {
        _id: toObjectId(announcementId),
        organizationId: toObjectId(organizationId),
      },
    },
    ...cardStagesOf({ detail: true }),
  ]);
  if (!row) throw new AppError("announcement_not_found", 404);
  assertMayAccessResidents(
    await actorStanding(actor, organizationId),
    row.branchId,
  );
  return cardOf(row);
};

const remindAnnouncement = async ({
  actor,
  organizationId,
  announcementId,
  now = new Date(),
}) => {
  if (!isValidObjectId(announcementId))
    throw new AppError("announcement_not_found", 404);
  const [announcement] = await Announcement.aggregate([
    {
      $match: {
        _id: toObjectId(announcementId),
        organizationId: toObjectId(organizationId),
      },
    },
    {
      $project: {
        branchId: 1,
        subject: 1,
        description: 1,
        pending: {
          $map: {
            input: {
              $filter: {
                input: "$recipients",
                as: "recipient",
                cond: { $eq: ["$$recipient.acknowledgedAt", null] },
              },
            },
            as: "recipient",
            in: "$$recipient.userId",
          },
        },
      },
    },
  ]);
  if (!announcement) throw new AppError("announcement_not_found", 404);

  assertMayAccessResidents(
    await actorStanding(actor, organizationId),
    announcement.branchId,
  );
  if (!announcement.pending.length)
    throw new AppError("announcement_all_acknowledged", 409);

  const claimed = await Announcement.updateOne(
    {
      _id: announcement._id,
      $or: [
        { remindedAt: null },
        { remindedAt: { $lt: new Date(now.getTime() - REMIND_COOLDOWN_MS) } },
      ],
    },
    { $set: { remindedAt: now } },
  );
  if (!claimed.modifiedCount)
    throw new AppError("announcement_reminded_recently", 429);

  await notify({
    receivers: announcement.pending,
    announcementId: announcement._id,
    actorId: actor._id,
    title: `Reminder: ${announcement.subject}`,
    text: announcement.description,
  });
  return { reminded: announcement.pending.length };
};

const mineOf = (userId) => ({
  $arrayElemAt: [
    {
      $filter: {
        input: "$recipients",
        as: "recipient",
        cond: { $eq: ["$$recipient.userId", userId] },
      },
    },
    0,
  ],
});

const listMine = async ({ actor, organizationId, page, limit, skip }) => {
  const userId = toObjectId(actor._id);
  const match = {
    organizationId: toObjectId(organizationId),
    "recipients.userId": userId,
  };
  const { result, data, meta } = await paginateWithFacet({
    model: Announcement,
    match,
    page,
    limit,
    skip,
    sort: { createdAt: -1, _id: -1 },
    extraFacets: {
      unread: [
        {
          $match: {
            ...match,
            recipients: { $elemMatch: { userId, seenAt: null } },
          },
        },
        { $count: "count" },
      ],
      read: [
        {
          $match: {
            ...match,
            recipients: { $elemMatch: { userId, seenAt: { $ne: null } } },
          },
        },
        { $count: "count" },
      ],
    },
    extraDataStages: [
      ...branchNameStages,
      ...createdByLookup,
      {
        $project: {
          _id: 1,
          branchName: 1,
          subject: 1,
          category: 1,
          createdAt: 1,
          createdBy: createdByProject,
          mine: mineOf(userId),
        },
      },
    ],
  });
  return {
    data: data.map(({ mine, createdBy, ...row }) => ({
      ...row,
      createdBy: createdByOf(createdBy),
      seen: Boolean(mine?.seenAt),
      acknowledged: Boolean(mine?.acknowledgedAt),
    })),
    meta: {
      ...meta,
      read: result.read?.[0]?.count ?? 0,
      unread: result.unread?.[0]?.count ?? 0,
    },
  };
};

const loadMine = async ({ actor, organizationId, announcementId }) => {
  if (!isValidObjectId(announcementId))
    throw new AppError("announcement_not_found", 404);
  const userId = toObjectId(actor._id);
  const [announcement] = await Announcement.aggregate([
    {
      $match: {
        _id: toObjectId(announcementId),
        organizationId: toObjectId(organizationId),
        "recipients.userId": userId,
      },
    },
    ...branchNameStages,
    ...createdByLookup,
    {
      $project: {
        branchName: 1,
        subject: 1,
        description: 1,
        category: 1,
        createdAt: 1,
        createdBy: createdByProject,
        mine: mineOf(userId),
      },
    },
  ]);
  if (!announcement) throw new AppError("announcement_not_found", 404);
  return { announcement, userId };
};

const stamp = ({ announcementId, userId, field, now }) =>
  Announcement.updateOne(
    { _id: announcementId },
    { $set: { [`recipients.$[recipient].${field}`]: now } },
    {
      arrayFilters: [
        { "recipient.userId": userId, [`recipient.${field}`]: null },
      ],
    },
  );

const getMine = async ({
  actor,
  organizationId,
  announcementId,
  now = new Date(),
}) => {
  const { announcement, userId } = await loadMine({
    actor,
    organizationId,
    announcementId,
  });
  await stamp({
    announcementId: announcement._id,
    userId,
    field: "seenAt",
    now,
  });
  const { mine, createdBy, ...rest } = announcement;
  return {
    ...rest,
    createdBy: createdByOf(createdBy),
    seen: true,
    acknowledged: Boolean(mine?.acknowledgedAt),
  };
};

module.exports = {
  createAnnouncement,
  listAnnouncements,
  getAnnouncement,
  remindAnnouncement,
  listMine,
  getMine,
};
