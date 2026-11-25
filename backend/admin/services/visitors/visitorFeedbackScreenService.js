const mongoose = require("mongoose");
const { VisitorSurveyResponse } = require("@models/VisitorSurveyResponse");
const { VisitSession } = require("@models/VisitSession");
const { AppError } = require("@services/_errors/AppError");
const visitorSurveyService = require("./visitorSurveyService");
const { actorStanding, scopeBranchFilter } = require("./visitorAccess");

const SEND_BY = ["notification", "email", "both"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_MS = 24 * 60 * 60 * 1000;

const sendByOf = (notifyVia = {}) => {
  if (notifyVia.email && notifyVia.inApp) return "both";
  if (notifyVia.email) return "email";
  return "notification";
};

const notifyViaOf = (sendBy) => ({
  email: sendBy === "email" || sendBy === "both",
  inApp: sendBy === "notification" || sendBy === "both",
});

const presentSettings = (settings) => ({
  enabled: settings.enabled,
  sendBy: sendByOf(settings.notifyVia),
  sendByOptions: [
    { key: "notification", label: "Notification" },
    { key: "email", label: "Email" },
    { key: "both", label: "Notification And Email" },
  ],
  recipients: settings.recipients,
  include: settings.include,
});

const durationLabel = (minutes) => {
  const total = Math.round(minutes);
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
};

const dayLabel = (value, now) => {
  const date = new Date(value);
  const startOf = (d) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const days = Math.round((startOf(now) - startOf(date)) / DAY_MS);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
};

const scopeOf = async ({ actor, organizationId, branchId }) => {
  const standing = await actorStanding(actor, organizationId);
  return scopeBranchFilter(standing, branchId);
};

const monthSummary = async ({ organizationId, branchId, now }) => {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const match = {
    organizationId: new mongoose.Types.ObjectId(String(organizationId)),
    createdAt: { $gte: start },
  };
  if (branchId) match.branchId = new mongoose.Types.ObjectId(String(branchId));

  const [row] = await VisitorSurveyResponse.aggregate([
    { $match: match },
    {
      $lookup: {
        from: VisitSession.collection.name,
        localField: "visitSessionId",
        foreignField: "_id",
        pipeline: [{ $project: { checkInAt: 1, checkOutAt: 1 } }],
        as: "visit",
      },
    },
    {
      $addFields: {
        visitMinutes: {
          $let: {
            vars: { visit: { $arrayElemAt: ["$visit", 0] } },
            in: {
              $cond: [
                { $and: ["$$visit.checkInAt", "$$visit.checkOutAt"] },
                {
                  $divide: [
                    { $subtract: ["$$visit.checkOutAt", "$$visit.checkInAt"] },
                    60000,
                  ],
                },
                null,
              ],
            },
          },
        },
      },
    },
    {
      $group: {
        _id: null,
        responses: { $sum: 1 },
        ratedCount: { $sum: { $cond: [{ $isNumber: "$rating" }, 1, 0] } },
        ratingSum: { $sum: { $cond: [{ $isNumber: "$rating" }, "$rating", 0] } },
        visitCount: { $sum: { $cond: [{ $isNumber: "$visitMinutes" }, 1, 0] } },
        visitSum: { $sum: { $cond: [{ $isNumber: "$visitMinutes" }, "$visitMinutes", 0] } },
      },
    },
  ]);

  const responses = row?.responses || 0;
  const averageRating = row?.ratedCount
    ? Math.round((row.ratingSum / row.ratedCount) * 10) / 10
    : null;
  const averageVisitMinutes = row?.visitCount
    ? Math.round(row.visitSum / row.visitCount)
    : null;
  const parts = [
    `${responses} ${responses === 1 ? "response" : "responses"}`,
    averageVisitMinutes == null ? "" : `Average visit ${durationLabel(averageVisitMinutes)}`,
  ].filter(Boolean);

  return {
    title: "This Month",
    responses,
    averageRating,
    averageVisitMinutes,
    averageVisit: averageVisitMinutes == null ? null : durationLabel(averageVisitMinutes),
    label: parts.join(" · "),
  };
};

const shapeItem = (row, now) => {
  const visited = String(row.whoVisited || row.hostName || "").trim();
  return {
    _id: row._id,
    visitorName: row.visitorName,
    rating: typeof row.rating === "number" ? row.rating : null,
    comment: row.comments || "",
    stayDuration: row.stayDuration || "",
    visited: visited ? `Saw ${visited}` : "",
    submittedAt: row.submittedAt || row.createdAt,
    when: [dayLabel(row.submittedAt || row.createdAt, now), row.stayDuration]
      .filter(Boolean)
      .join(" "),
  };
};

const getVisitorFeedbackScreen = async ({
  actor,
  organizationId,
  branchId,
  page,
  limit,
  skip,
  now = new Date(),
}) => {
  const scoped = await scopeOf({ actor, organizationId, branchId });
  const [settings, summary, list] = await Promise.all([
    visitorSurveyService.getVisitorSurveySettings({ actor, organizationId }),
    monthSummary({ organizationId, branchId: scoped, now }),
    visitorSurveyService.listVisitorSurveyResponses({
      actor,
      organizationId,
      branchId: scoped || undefined,
      page,
      limit,
      skip,
    }),
  ]);

  return {
    settings: presentSettings(settings),
    thisMonth: summary,
    items: list.data.map((row) => shapeItem(row, now)),
    meta: list.meta,
  };
};

const saveVisitorFeedbackSettings = async ({ actor, organizationId, body = {} }) => {
  const current = await visitorSurveyService.getVisitorSurveySettings({ actor, organizationId });
  const next = { ...current };

  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean")
      throw new AppError("invalid_visitor_survey_settings", 400, { field: "enabled" });
    next.enabled = body.enabled;
  }
  if (body.sendBy !== undefined) {
    if (!SEND_BY.includes(body.sendBy))
      throw new AppError("invalid_visitor_survey_settings", 400, { field: "sendBy" });
    next.notifyVia = notifyViaOf(body.sendBy);
  }
  if (body.enabled === undefined && body.sendBy === undefined)
    throw new AppError("nothing_to_update", 400);

  const saved = await visitorSurveyService.saveVisitorSurveySettings({
    actor,
    organizationId,
    body: next,
  });
  return presentSettings(saved);
};

module.exports = { getVisitorFeedbackScreen, saveVisitorFeedbackSettings };
