const mongoose = require("mongoose");
const { Organization } = require("@models/Organization");
const { Membership } = require("@models/Membership");
const { User } = require("@models/UserModel");
const { Branch } = require("@models/Branch");
const { StaffProfile } = require("@models/StaffProfile");
const { VisitSession } = require("@models/VisitSession");
const { VisitorSurveyQuestion } = require("@models/VisitorSurveyQuestion");
const { VisitorSurveyResponse } = require("@models/VisitorSurveyResponse");
const { NotificationExp, NotificationTypes } = require("@models/Notifications");
const { AppError } = require("@services/_errors/AppError");
const { sendTransactionalEmail } = require("@utils/mailer");
const { paginateWithFacet } = require("@utils/paginate");
const {
  MembershipRole,
  ActiveInactiveStatus,
  VisitorSurveyQuestionType,
  VisitorSurveyQuestionSource,
  VisitorSurveyResponseSource,
} = require("@models/domainEnums");
const {
  actorStanding,
  assertBranchInOrganization,
} = require("./visitorAccess");

const SETTINGS_ROLES = new Set([
  MembershipRole.SUPER_ADMIN,
  MembershipRole.OWNER,
]);

const LOG_ROLES = new Set([
  MembershipRole.SUPER_ADMIN,
  MembershipRole.OWNER,
  MembershipRole.SITE_MANAGER,
  MembershipRole.LINE_MANAGER,
]);

const SYSTEM_QUESTIONS = [
  {
    key: "expectedVisit",
    prompt: "Was your visit for the reason you expected?",
    type: VisitorSurveyQuestionType.YES_NO,
    options: ["Yes", "No", "Other"],
    required: true,
    sortOrder: 1,
  },
  {
    key: "whoVisited",
    prompt: "Who did you visit today?",
    type: VisitorSurveyQuestionType.SINGLE_SELECT,
    options: ["Resident / Family member"],
    required: true,
    sortOrder: 2,
  },
  {
    key: "rating",
    prompt: "How would you rate your visit overall?",
    type: VisitorSurveyQuestionType.RATING,
    options: [],
    required: true,
    sortOrder: 3,
  },
  {
    key: "comments",
    prompt: "Any comment you'd like to share?",
    type: VisitorSurveyQuestionType.TEXT,
    options: [],
    required: false,
    sortOrder: 4,
  },
];

const SYSTEM_KEYS = new Set(SYSTEM_QUESTIONS.map((row) => row.key));
const readyOrgs = new Set();

const defaultSettings = () => ({
  enabled: false,
  notifyVia: { email: true, inApp: true },
  recipients: { siteManager: true, lineManager: false },
  include: {
    ratingSummary: true,
    visitDuration: true,
    whoTheyVisited: true,
    freeText: true,
  },
});

const flag = (value, fallback) =>
  value === undefined ? fallback : Boolean(value);

const presentSettings = (stored = {}) => {
  const defaults = defaultSettings();
  return {
    enabled: flag(stored.enabled, defaults.enabled),
    notifyVia: {
      email: flag(stored.notifyVia?.email, defaults.notifyVia.email),
      inApp: flag(stored.notifyVia?.inApp, defaults.notifyVia.inApp),
    },
    recipients: {
      siteManager: flag(
        stored.recipients?.siteManager,
        defaults.recipients.siteManager
      ),
      lineManager: flag(
        stored.recipients?.lineManager,
        defaults.recipients.lineManager
      ),
    },
    include: {
      ratingSummary: flag(
        stored.include?.ratingSummary,
        defaults.include.ratingSummary
      ),
      visitDuration: flag(
        stored.include?.visitDuration,
        defaults.include.visitDuration
      ),
      whoTheyVisited: flag(
        stored.include?.whoTheyVisited,
        defaults.include.whoTheyVisited
      ),
      freeText: flag(stored.include?.freeText, defaults.include.freeText),
    },
  };
};

const parseSettings = (input) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new AppError("visitor_survey_settings_required", 400);
  }
  return presentSettings(input);
};

const toOid = (value, key = "invalid_id") => {
  if (!value || !mongoose.Types.ObjectId.isValid(String(value))) {
    throw new AppError(key, 400);
  }
  return new mongoose.Types.ObjectId(String(value));
};

const assertSettingsRole = (standing) => {
  if (!SETTINGS_ROLES.has(standing.role)) {
    throw new AppError("insufficient_role", 403);
  }
};

const assertLogRole = (standing) => {
  if (!LOG_ROLES.has(standing.role)) {
    throw new AppError("insufficient_role", 403);
  }
};

const loadOrganization = async (organizationId) => {
  const organization = await Organization.findById(organizationId)
    .select("settings")
    .lean();
  if (!organization) throw new AppError("organization_not_found", 404);
  return organization;
};

const getVisitorSurveySettings = async ({ actor, organizationId }) => {
  const standing = await actorStanding(actor, organizationId);
  assertLogRole(standing);
  const organization = await loadOrganization(organizationId);
  return presentSettings(organization.settings?.visitorSurvey);
};

const saveVisitorSurveySettings = async ({ actor, organizationId, body }) => {
  const standing = await actorStanding(actor, organizationId);
  assertSettingsRole(standing);
  const next = parseSettings(body);
  const organization = await Organization.findByIdAndUpdate(
    organizationId,
    { $set: { "settings.visitorSurvey": next } },
    { new: true, runValidators: true }
  )
    .select("settings")
    .lean();
  if (!organization) throw new AppError("organization_not_found", 404);
  return presentSettings(organization.settings?.visitorSurvey);
};

const shapeQuestion = (row) => ({
  _id: row._id,
  key: row.key,
  prompt: row.prompt,
  type: row.type,
  options: row.options || [],
  required: Boolean(row.required),
  sortOrder: row.sortOrder || 0,
  active: row.active !== false,
  source: row.source,
});

const ensureQuestions = async (organizationId) => {
  const orgId = toOid(organizationId, "invalid_organization_id");
  const cacheKey = String(orgId);
  if (readyOrgs.has(cacheKey)) return orgId;

  const exists = await VisitorSurveyQuestion.exists({ organizationId: orgId });
  if (!exists) {
    await VisitorSurveyQuestion.insertMany(
      SYSTEM_QUESTIONS.map((row) => ({
        ...row,
        organizationId: orgId,
        source: VisitorSurveyQuestionSource.SYSTEM,
        active: true,
      }))
    );
  }
  readyOrgs.add(cacheKey);
  return orgId;
};

const listVisitorSurveyQuestions = async ({
  actor,
  organizationId,
  includeInactive,
}) => {
  const standing = await actorStanding(actor, organizationId);
  assertLogRole(standing);
  const orgId = await ensureQuestions(organizationId);
  const match = { organizationId: orgId };
  if (!includeInactive) match.active = true;
  const rows = await VisitorSurveyQuestion.find(match)
    .sort({ sortOrder: 1, createdAt: 1 })
    .lean();
  return rows.map(shapeQuestion);
};

const parseQuestionType = (value) => {
  if (!Object.values(VisitorSurveyQuestionType).includes(value)) {
    throw new AppError("invalid_visitor_survey_question_type", 400);
  }
  return value;
};

const slugKey = (value, index) => {
  const raw = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return raw || `question_${index + 1}`;
};

const saveVisitorSurveyQuestions = async ({ actor, organizationId, questions }) => {
  const standing = await actorStanding(actor, organizationId);
  assertSettingsRole(standing);
  const orgId = await ensureQuestions(organizationId);
  if (!Array.isArray(questions) || !questions.length) {
    throw new AppError("visitor_survey_questions_required", 400);
  }

  const existing = await VisitorSurveyQuestion.find({ organizationId: orgId });
  const byId = new Map(existing.map((row) => [String(row._id), row]));
  const byKey = new Map(existing.map((row) => [row.key, row]));
  const keepIds = new Set();
  const usedKeys = new Set();

  for (let index = 0; index < questions.length; index += 1) {
    const item = questions[index] || {};
    const prompt = String(item.prompt || "").trim();
    if (!prompt) throw new AppError("visitor_survey_prompt_required", 400);
    const type = parseQuestionType(item.type);
    const options = Array.isArray(item.options)
      ? item.options.map((option) => String(option).trim()).filter(Boolean)
      : [];
    const sortOrder =
      item.sortOrder == null ? index + 1 : Number(item.sortOrder) || index + 1;

    let row = item._id ? byId.get(String(item._id)) : null;
    if (!row && item.key) row = byKey.get(String(item.key));

    if (row) {
      if (row.source === VisitorSurveyQuestionSource.SYSTEM) {
        row.prompt = prompt;
        row.type = type;
        row.options = options;
        row.required = item.required !== false;
        row.sortOrder = sortOrder;
        row.active = item.active !== false;
      } else {
        const nextKey = item.key ? String(item.key).trim() : row.key;
        if (SYSTEM_KEYS.has(nextKey) && nextKey !== row.key) {
          throw new AppError("visitor_survey_key_reserved", 400);
        }
        row.key = nextKey;
        row.prompt = prompt;
        row.type = type;
        row.options = options;
        row.required = Boolean(item.required);
        row.sortOrder = sortOrder;
        row.active = item.active !== false;
      }
      if (usedKeys.has(row.key)) throw new AppError("visitor_survey_key_taken", 409);
      usedKeys.add(row.key);
      keepIds.add(String(row._id));
      await row.save();
      continue;
    }

    const key = item.key ? String(item.key).trim() : slugKey(prompt, index);
    if (SYSTEM_KEYS.has(key) || usedKeys.has(key) || byKey.has(key)) {
      throw new AppError("visitor_survey_key_taken", 409);
    }
    usedKeys.add(key);
    const created = await VisitorSurveyQuestion.create({
      organizationId: orgId,
      key,
      prompt,
      type,
      options,
      required: Boolean(item.required),
      sortOrder,
      active: item.active !== false,
      source: VisitorSurveyQuestionSource.CUSTOM,
    });
    keepIds.add(String(created._id));
    byKey.set(key, created);
  }

  const extras = existing.filter((row) => !keepIds.has(String(row._id)));
  const extraIds = extras
    .filter((row) => row.source !== VisitorSurveyQuestionSource.SYSTEM)
    .map((row) => row._id);
  const inUse = extraIds.length
    ? new Set(
        (
          await VisitorSurveyResponse.distinct("answers.questionId", {
            organizationId: orgId,
            "answers.questionId": { $in: extraIds },
          })
        ).map(String)
      )
    : new Set();

  for (const row of extras) {
    if (row.source === VisitorSurveyQuestionSource.SYSTEM || inUse.has(String(row._id))) {
      row.active = false;
      await row.save();
    } else {
      await row.deleteOne();
    }
  }

  const rows = await VisitorSurveyQuestion.find({ organizationId: orgId })
    .sort({ sortOrder: 1, createdAt: 1 })
    .lean();
  return rows.map(shapeQuestion);
};

const answerValue = (value) => {
  if (value == null) return "";
  if (typeof value === "number") return value;
  return String(value).trim();
};

const notifyManagers = async ({
  organizationId,
  branchId,
  actor,
  response,
  settings,
}) => {
  if (!settings.enabled) return null;
  const roles = [];
  if (settings.recipients.siteManager) roles.push(MembershipRole.SITE_MANAGER);
  if (settings.recipients.lineManager) roles.push(MembershipRole.LINE_MANAGER);
  if (!roles.length) return null;

  const match = {
    organizationId,
    role: { $in: roles },
    status: ActiveInactiveStatus.ACTIVE,
  };
  if (branchId) {
    match.$or = [{ branchId }, { branchId: null }];
  }

  const memberships = await Membership.find(match).select("userId").lean();
  const receiverIds = [
    ...new Set(memberships.map((row) => String(row.userId))),
  ].filter((id) => id !== String(actor._id));
  if (!receiverIds.length) return null;

  const bits = [`Visitor feedback from ${response.visitorName}`];
  if (settings.include.ratingSummary && response.rating != null) {
    bits.push(`Rating: ${response.rating}/5`);
  }
  if (settings.include.visitDuration && response.stayDuration) {
    bits.push(`Stay: ${response.stayDuration}`);
  }
  if (settings.include.whoTheyVisited && response.whoVisited) {
    bits.push(`Visited: ${response.whoVisited}`);
  }
  if (settings.include.freeText && response.comments) {
    bits.push(response.comments);
  }
  const body = bits.join(" — ");
  const title = "Visitor survey completed";

  if (settings.notifyVia.inApp) {
    await NotificationExp.insertMany(
      receiverIds.map((receiverId) => ({
        type: NotificationTypes.VISITOR_SURVEY,
        subjectId: actor._id,
        objectId: response._id,
        objectType: "VisitorSurveyResponse",
        receiverId,
        title,
        body,
      }))
    );
  }

  if (settings.notifyVia.email) {
    const users = await User.find({ _id: { $in: receiverIds } })
      .select("email")
      .lean();
    const emails = users.map((user) => user.email).filter(Boolean);
    if (emails.length) {
      await sendTransactionalEmail({
        to: emails,
        subject: title,
        html: `<p>${body}</p>`,
      });
    }
  }

  return new Date();
};

const resolveHostStaffId = async ({
  organizationId,
  branchId,
  visitSessionId,
  hostStaffId,
}) => {
  if (hostStaffId) {
    const staff = await StaffProfile.findOne({
      _id: toOid(hostStaffId, "invalid_staff_profile_id"),
      organizationId,
    })
      .select("_id")
      .lean();
    if (!staff) throw new AppError("invalid_staff_profile_id", 400);
    return staff._id;
  }
  if (!visitSessionId) return null;
  const visit = await VisitSession.findOne({
    _id: toOid(visitSessionId, "invalid_visit_session_id"),
    branchId,
  })
    .select("hostStaffId")
    .lean();
  return visit?.hostStaffId || null;
};

const createVisitorSurveyResponse = async ({
  actor,
  organizationId,
  branchId,
  visitSessionId,
  externalPersonId,
  hostStaffId,
  visitorName,
  stayDuration,
  answers,
  source,
}) => {
  const standing = await actorStanding(actor, organizationId);
  assertLogRole(standing);
  if (!branchId) throw new AppError("branch_required", 400);
  await assertBranchInOrganization(branchId, organizationId);

  const name = String(visitorName || "").trim();
  if (!name) throw new AppError("name_required", 400);
  if (!Array.isArray(answers)) throw new AppError("visitor_survey_answers_required", 400);

  const orgId = await ensureQuestions(organizationId);
  const questions = await VisitorSurveyQuestion.find({
    organizationId: orgId,
    active: true,
  }).lean();
  const byId = new Map(questions.map((row) => [String(row._id), row]));

  const given = new Map();
  for (const item of answers) {
    const question = byId.get(String(item.questionId || ""));
    if (!question) throw new AppError("visitor_survey_question_not_found", 400);
    given.set(String(question._id), answerValue(item.value));
  }

  for (const question of questions) {
    if (!question.required) continue;
    const value = given.get(String(question._id));
    if (value === undefined || value === "") {
      throw new AppError("visitor_survey_answer_required", 400);
    }
  }

  const storedAnswers = questions
    .filter((question) => given.has(String(question._id)))
    .map((question) => ({
      questionId: question._id,
      key: question.key,
      prompt: question.prompt,
      value: given.get(String(question._id)),
    }));

  const pick = (key) =>
    storedAnswers.find((row) => row.key === key)?.value ?? "";

  const ratingRaw = pick("rating");
  const rating =
    ratingRaw === "" || ratingRaw == null ? null : Number(ratingRaw);

  const organization = await loadOrganization(organizationId);
  const settings = presentSettings(organization.settings?.visitorSurvey);
  const hostId = await resolveHostStaffId({
    organizationId: orgId,
    branchId: toOid(branchId, "invalid_branch_id"),
    visitSessionId,
    hostStaffId,
  });

  const row = await VisitorSurveyResponse.create({
    organizationId: orgId,
    branchId: toOid(branchId, "invalid_branch_id"),
    visitSessionId: visitSessionId
      ? toOid(visitSessionId, "invalid_visit_session_id")
      : null,
    externalPersonId: externalPersonId
      ? toOid(externalPersonId, "invalid_external_person_id")
      : null,
    hostStaffId: hostId,
    visitorName: name,
    stayDuration: stayDuration ? String(stayDuration).trim() : "",
    answers: storedAnswers,
    rating: Number.isFinite(rating) ? rating : null,
    whoVisited: String(pick("whoVisited") || ""),
    comments: String(pick("comments") || ""),
    source: Object.values(VisitorSurveyResponseSource).includes(source)
      ? source
      : VisitorSurveyResponseSource.ADMIN_MANUAL,
    submittedByUserId: actor._id,
  });

  try {
    const notifiedAt = await notifyManagers({
      organizationId: orgId,
      branchId: row.branchId,
      actor,
      response: row,
      settings,
    });
    if (notifiedAt) {
      row.notifiedAt = notifiedAt;
      await row.save();
    }
  } catch (error) {
    const log = global.logger;
    if (log?.error) log.error("visitor survey notify failed", { error: error.message });
    else console.error("visitor survey notify failed", error);
  }

  return row.toObject();
};

const escapeRegex = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const firstFilled = (candidates) => ({
  $ifNull: [
    {
      $arrayElemAt: [
        {
          $filter: {
            input: candidates,
            as: "candidate",
            cond: {
              $and: [
                { $ne: ["$$candidate", null] },
                { $ne: ["$$candidate", ""] },
              ],
            },
          },
        },
        0,
      ],
    },
    "",
  ],
});

const feedbackRowStages = () => [
  {
    $lookup: {
      from: Branch.collection.name,
      localField: "branchId",
      foreignField: "_id",
      as: "branch",
    },
  },
  {
    $lookup: {
      from: VisitSession.collection.name,
      localField: "visitSessionId",
      foreignField: "_id",
      as: "visit",
    },
  },
  {
    $addFields: {
      hostId: {
        $ifNull: [
          "$hostStaffId",
          { $arrayElemAt: ["$visit.hostStaffId", 0] },
          null,
        ],
      },
    },
  },
  {
    $lookup: {
      from: StaffProfile.collection.name,
      localField: "hostId",
      foreignField: "_id",
      as: "host",
    },
  },
  {
    $lookup: {
      from: User.collection.name,
      localField: "host.userId",
      foreignField: "_id",
      as: "hostUser",
    },
  },
  {
    $addFields: {
      branchName: { $ifNull: [{ $arrayElemAt: ["$branch.name", 0] }, ""] },
      hostName: firstFilled([
        { $arrayElemAt: ["$hostUser.name", 0] },
        { $arrayElemAt: ["$visit.hostName", 0] },
        "$whoVisited",
      ]),
      submittedAt: "$createdAt",
    },
  },
  { $project: { branch: 0, visit: 0, host: 0, hostUser: 0 } },
];

const listVisitorSurveyResponses = async ({
  actor,
  organizationId,
  branchId,
  search,
  page,
  limit,
  skip,
}) => {
  const standing = await actorStanding(actor, organizationId);
  assertLogRole(standing);
  const match = {
    organizationId: toOid(organizationId, "invalid_organization_id"),
  };
  if (branchId) {
    await assertBranchInOrganization(branchId, organizationId);
    match.branchId = toOid(branchId, "invalid_branch_id");
  }
  const term = String(search || "").trim();
  if (term) match.visitorName = { $regex: escapeRegex(term), $options: "i" };
  return paginateWithFacet({
    model: VisitorSurveyResponse,
    match,
    page,
    limit,
    skip,
    sort: { createdAt: -1 },
    extraDataStages: feedbackRowStages(),
  });
};

module.exports = {
  getVisitorSurveySettings,
  saveVisitorSurveySettings,
  listVisitorSurveyQuestions,
  saveVisitorSurveyQuestions,
  createVisitorSurveyResponse,
  listVisitorSurveyResponses,
};
