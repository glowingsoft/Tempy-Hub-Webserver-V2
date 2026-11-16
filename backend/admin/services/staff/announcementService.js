const {
  Announcement,
  MAX_SUBJECT_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_CATEGORY_LENGTH,
} = require("@models/Announcement");
const { StaffProfile } = require("@models/StaffProfile");
const { Department } = require("@models/Department");
const { NotificationExp, NotificationTypes } = require("@models/Notifications");
const { StaffProfileStatus } = require("@models/domainEnums");
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
  toObjectId,
  isValidObjectId,
} = require("@appServices/family/familyPipeline");

const ALL_STAFF = "All Staff";
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

const countWhere = (field) => ({
  $size: {
    $filter: {
      input: "$recipients",
      as: "recipient",
      cond: { $ne: [`$$recipient.${field}`, null] },
    },
  },
});

const cardStages = [
  {
    $lookup: {
      from: Department.collection.name,
      localField: "departmentIds",
      foreignField: "_id",
      as: "departments",
    },
  },
  {
    $project: {
      _id: 1,
      subject: 1,
      category: 1,
      createdAt: 1,
      departments: "$departments.name",
      recipients: { $size: "$recipients" },
      seen: countWhere("seenAt"),
      acknowledged: countWhere("acknowledgedAt"),
    },
  },
];

const cardOf = ({ departments, ...row }) => ({
  ...row,
  audience: departments.length ? [...departments].sort().join(", ") : ALL_STAFF,
  allAcknowledged: row.recipients > 0 && row.acknowledged === row.recipients,
});

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

/** The Create Announcement screen: sent to every active staff member of the site, or only to the chosen departments. */
const createAnnouncement = async ({
  actor,
  organizationId,
  branchId,
  subject,
  description,
  category,
  departmentIds,
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
  const departments = await cleanDepartmentIds({
    value: departmentIds,
    organizationId,
    siteId,
  });

  const staff = await StaffProfile.aggregate([
    {
      $match: {
        organizationId: toObjectId(organizationId),
        branchId: siteId,
        status: StaffProfileStatus.ACTIVE,
        userId: { $nin: [toObjectId(actor._id), null] },
        ...(departments.length ? { departmentIds: { $in: departments } } : {}),
      },
    },
    { $group: { _id: "$userId" } },
  ]);
  if (!staff.length) throw new AppError("announcement_no_recipients", 400);

  const created = await Announcement.create({
    organizationId: toObjectId(organizationId),
    branchId: siteId,
    createdBy: actor._id,
    ...cleaned,
    departmentIds: departments,
    recipients: staff.map((row) => ({ userId: row._id })),
  });
  await notify({
    receivers: staff.map((row) => row._id),
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
    subject: created.subject,
    category: created.category,
    createdAt: created.createdAt,
    departments: names,
    recipients: staff.length,
    seen: 0,
    acknowledged: 0,
  });
};

/** The Announcements screen: newest first, with how many have seen and acknowledged each one. */
const listAnnouncements = async ({
  actor,
  organizationId,
  branchId,
  page,
  limit,
  skip,
}) => {
  const siteId = toObjectId(
    await resolveLiveBranchId({ actor, organizationId, branchId }),
  );
  const { data, meta } = await paginateWithFacet({
    model: Announcement,
    match: { organizationId: toObjectId(organizationId), branchId: siteId },
    page,
    limit,
    skip,
    sort: { createdAt: -1, _id: -1 },
    extraDataStages: cardStages,
  });
  return { data: data.map(cardOf), meta };
};

/** "Remind the 7 who haven't": notifies only the people who have not acknowledged yet, once an hour at most. */
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

/** The staff member's own announcements, newest first; meta.unread counts the ones not opened yet. */
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
    },
    extraDataStages: [
      {
        $project: {
          _id: 1,
          subject: 1,
          category: 1,
          createdAt: 1,
          mine: mineOf(userId),
        },
      },
    ],
  });
  return {
    data: data.map(({ mine, ...row }) => ({
      ...row,
      seen: Boolean(mine?.seenAt),
      acknowledged: Boolean(mine?.acknowledgedAt),
    })),
    meta: { ...meta, unread: result.unread?.[0]?.count ?? 0 },
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
    {
      $project: {
        subject: 1,
        description: 1,
        category: 1,
        createdAt: 1,
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

/** Opening an announcement marks it seen. */
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
  const { mine, ...rest } = announcement;
  return { ...rest, seen: true, acknowledged: Boolean(mine?.acknowledgedAt) };
};

const acknowledgeAnnouncement = async ({
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
  await stamp({
    announcementId: announcement._id,
    userId,
    field: "acknowledgedAt",
    now,
  });
  return { _id: announcement._id, seen: true, acknowledged: true };
};

module.exports = {
  createAnnouncement,
  listAnnouncements,
  remindAnnouncement,
  listMine,
  getMine,
  acknowledgeAnnouncement,
};
