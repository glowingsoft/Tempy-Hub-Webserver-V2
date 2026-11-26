const { Branch } = require("@models/Branch");
const { Resident } = require("@models/Resident");
const { FamilyMember } = require("@models/FamilyMember");
const { FamilyVisit } = require("@models/FamilyVisit");
const { FamilyPost } = require("@models/FamilyPost");
const { FamilyMedia } = require("@models/FamilyMedia");
const { FamilyReaction } = require("@models/FamilyReaction");
const { FamilyNewsletter } = require("@models/FamilyNewsletter");
const { FamilyGazetteIssue } = require("@models/FamilyGazetteIssue");
const { FamilyGazetteItem } = require("@models/FamilyGazetteItem");
const {
  AdmissionStatus,
  FamilyMemberStatus,
  FamilyVisitStatus,
  FamilyNewsletterStatus,
  FamilyPostStatus,
  FamilyGazetteItemStatus,
} = require("@models/domainEnums");
const { AppError } = require("@services/_errors/AppError");
const { generateMeta } = require("@utils/responseUtil");
const {
  toObjectId,
  isValidObjectId,
} = require("@appServices/family/familyPipeline");
const { loadRules } = require("@appServices/family/familyVisitRules");
const { resolveSite } = require("./familySite");
const { getGazetteRules } = require("./familySettingsService");
const { cardOfSite, sitesOf } = require("./familyGazetteCard");
const { getAttention } = require("./familyWallActivityService");
const { publishedPostsOfSite } = require("./familyPostFilters");
const familyPostService = require("./familyPostService");
const newsletterService = require("./familyNewsletterService");

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const ESCALATE_AFTER_DAYS = 7;
const MAX_STORY_TEXT = 500;
const MAX_POST_STORY_TEXT = 1000;
const MAX_HIGHLIGHTS = 12;
const MAX_NOTICES = 10;
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

const shortDate = (value, timeZone = "Europe/London") => {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).format(new Date(value));
  const [, month, day] = parts.split("-").map(Number);
  return `${day} ${MONTHS[month - 1]}`;
};

const plural = (count, word) => `${count} ${count === 1 ? word : `${word}s`}`;

const siteOf = async ({ actor, organizationId, branchId }) => {
  const site = await resolveSite({ actor, organizationId, branchId });
  const branch = await Branch.findById(site.branchId)
    .select("name timezone")
    .lean();
  return {
    branchId: site.branchId,
    name: branch?.name || "",
    timezone: branch?.timezone || "Europe/London",
  };
};

const gazetteOfSite = async ({ organizationId, branchId, now }) => {
  const rules = await getGazetteRules({ organizationId });
  if (!rules.configured) return null;
  const [site] = await sitesOf({ organizationId, branchId });
  if (!site) return null;
  return cardOfSite({ organizationId, site, rules, now });
};

const gazetteCountsLabel = ({ ready, noContent, overCap, noFamily }, cap) =>
  [
    `${ready} Ready`,
    `${noContent} No Content`,
    `${overCap} Over ${cap}`,
    `${noFamily} No Family Linked`,
  ].join(" - ");

const noContentNotice = (count) =>
  count
    ? {
        count,
        title: `${count} ${count === 1 ? "Resident Has" : "Residents Have"} No Content`,
      }
    : null;

const presentGazette = (card, timeZone) => {
  if (!card) return { scheduled: false, gazetteId: null };
  const { total, withContent, noContent, noFamily, overCap } = card.residents;
  const ready = Math.max(withContent - overCap, 0);
  return {
    scheduled: true,
    gazetteId: card.issueId ?? null,
    number: card.number,
    state: card.state,
    closesAt: card.closesAt,
    closesInDays: card.closesInDays,
    messageCap: card.messageCap,
    title: `Gazette No. ${card.number} - Closes ${shortDate(card.closesAt, timeZone)}`,
    residentsLabel: plural(total, "Resident"),
    counts: { total, ready, noContent, overCap, noFamily },
    countsLabel: gazetteCountsLabel(
      { ready, noContent, overCap, noFamily },
      card.messageCap,
    ),
  };
};

const ageLabel = (value, now) => {
  if (!value) return "";
  const hours = Math.max(Math.floor((now - new Date(value)) / HOUR_MS), 0);
  return hours < 48 ? `Oldest ${hours}h` : `Oldest ${Math.floor(hours / 24)}d`;
};

const dayName = (value, now) => {
  if (!value) return "";
  const startOf = (d) =>
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const days = Math.round((startOf(now) - startOf(new Date(value))) / DAY_MS);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return shortDate(value);
};

const weekendOf = (now) => {
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const day = start.getUTCDay();
  const toSaturday = day === 0 ? -1 : 6 - day;
  const saturday = new Date(start.getTime() + toSaturday * DAY_MS);
  return { start: saturday, end: new Date(saturday.getTime() + 2 * DAY_MS) };
};

const newsletterStatusLabel = (status) =>
  String(status || "").replace(/^./, (letter) => letter.toUpperCase());

const getHome = async ({
  actor,
  organizationId,
  branchId,
  now = new Date(),
}) => {
  const site = await siteOf({ actor, organizationId, branchId });
  const scope = {
    organizationId: toObjectId(organizationId),
    branchId: toObjectId(site.branchId),
  };

  const [attention, familyResidents, joins, visits, card, newsletter, rules] =
    await Promise.all([
      getAttention({ organizationId, branchId: site.branchId }),
      FamilyMember.distinct("residentId", {
        ...scope,
        status: FamilyMemberStatus.ACTIVE,
      }),
      FamilyMember.find({ ...scope, status: FamilyMemberStatus.PENDING })
        .select("requestedAt")
        .lean(),
      FamilyVisit.find({
        ...scope,
        status: FamilyVisitStatus.REQUESTED,
        endAt: { $gte: now },
      })
        .sort({ startAt: 1 })
        .select("startAt")
        .lean(),
      gazetteOfSite({ organizationId, branchId: site.branchId, now }),
      FamilyNewsletter.findOne(scope)
        .sort({ periodStart: -1 })
        .select("status month title issueNumber")
        .lean(),
      loadRules(site.branchId),
    ]);

  const escalated = joins.filter(
    (row) =>
      row.requestedAt &&
      now - new Date(row.requestedAt) >= ESCALATE_AFTER_DAYS * DAY_MS,
  ).length;
  const weekend = weekendOf(now);
  const thisWeekend = visits.filter(
    (row) => row.startAt >= weekend.start && row.startAt < weekend.end,
  ).length;
  const photos = attention.pendingUploads;
  const reports = attention.reportedPosts;

  return {
    site: {
      branchId: site.branchId,
      name: site.name,
      families: familyResidents.length,
      label: `${site.name} - ${familyResidents.length} ${familyResidents.length === 1 ? "Family" : "Families"}`,
    },
    cards: {
      photosToCheck: {
        count: photos.count,
        oldestAt: photos.oldestAt,
        label: photos.count ? ageLabel(photos.oldestAt, now) : "",
      },
      joinRequests: {
        count: joins.length,
        escalated,
        label: escalated ? `${escalated} Escalated` : "",
      },
      visitRequests: {
        count: visits.length,
        thisWeekend,
        label: thisWeekend
          ? "This Weekend"
          : visits.length
            ? `Next ${shortDate(visits[0].startAt, site.timezone)}`
            : "",
      },
      reportedPosts: {
        count: reports.count,
        oldestAt: reports.oldestAt,
        label: reports.count ? dayName(reports.oldestAt, now) : "",
      },
    },
    gazette: presentGazette(card, site.timezone),
    newsletter: newsletter
      ? {
          newsletterId: newsletter._id,
          title: newsletter.title,
          month: newsletter.month,
          status: newsletter.status,
          badge: newsletterStatusLabel(newsletter.status),
        }
      : null,
    visiting: {
      open: !rules.paused,
      label: rules.paused ? "Paused" : "Open",
      reason: rules.paused ? rules.pausedReason || "" : "",
    },
  };
};

const surnameFirst = (name) => {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length < 2) return parts.join("");
  return `${parts[parts.length - 1]}, ${parts.slice(0, -1).join(" ")}`;
};

const gazetteRow = (row, resident, cap) => {
  let status = "ready";
  if (!row.hasFamily) status = "noFamily";
  else if (!row.messageCount) status = "noContent";
  else if (row.messageCount > cap) status = "overCap";
  const messages = plural(row.messageCount, "Message");
  const view = {
    ready: { subtitle: `Ready - ${messages}`, tag: "Ready" },
    noContent: { subtitle: "No Messages Yet", tag: "No Content" },
    overCap: { subtitle: messages, tag: `Over ${cap}` },
    noFamily: { subtitle: "No Family Linked", tag: "Invite" },
  }[status];
  return {
    residentId: row.residentId,
    name: resident?.name || "",
    displayName: surnameFirst(resident?.name),
    roomNumber: resident?.roomNumber || "",
    messageCount: row.messageCount,
    status,
    subtitle: view.subtitle,
    tag: { key: status === "noFamily" ? "invite" : status, label: view.tag },
  };
};

const getGazette = async ({
  actor,
  organizationId,
  branchId,
  page,
  limit,
  skip,
  now = new Date(),
}) => {
  const site = await siteOf({ actor, organizationId, branchId });
  const card = await gazetteOfSite({
    organizationId,
    branchId: site.branchId,
    now,
  });
  const summary = presentGazette(card, site.timezone);
  if (!card)
    return {
      gazette: summary,
      noContent: null,
      residents: [],
      meta: generateMeta(page, limit, 0),
    };

  const residents = await Resident.find({
    _id: { $in: card.byResident.map((row) => row.residentId) },
  })
    .select("name roomNumber")
    .lean();
  const byId = new Map(
    residents.map((resident) => [String(resident._id), resident]),
  );
  const rows = card.byResident
    .map((row) =>
      gazetteRow(row, byId.get(String(row.residentId)), card.messageCap),
    )
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  return {
    gazette: summary,
    noContent: noContentNotice(card.residents.noContent),
    residents: rows.slice(skip, skip + limit),
    meta: generateMeta(page, limit, rows.length),
  };
};

const issuedRow = (item, resident, cap) => {
  const base = gazetteRow(
    {
      residentId: item.residentId,
      hasFamily: item.status !== FamilyGazetteItemStatus.NO_FAMILY,
      messageCount: item.messageCount || 0,
    },
    resident,
    cap,
  );
  const fixed = {
    [FamilyGazetteItemStatus.PRINTED]: "Printed",
    [FamilyGazetteItemStatus.BUILDING]: "Building",
    [FamilyGazetteItemStatus.FAILED]: "Failed",
  }[item.status];
  if (fixed)
    return {
      ...base,
      status: item.status,
      subtitle: plural(base.messageCount, "Message"),
      tag: { key: item.status, label: fixed },
    };
  if (item.status === FamilyGazetteItemStatus.NO_CONTENT)
    return {
      ...base,
      status: "noContent",
      subtitle: "No Messages Yet",
      tag: { key: "noContent", label: "No Content" },
    };
  return base;
};

const getGazetteDetail = async ({
  organizationId,
  branchScope,
  gazetteId,
  page,
  limit,
  skip,
}) => {
  if (!isValidObjectId(gazetteId)) throw new AppError("gazette_not_found", 404);
  const issue = await FamilyGazetteIssue.findOne({
    _id: gazetteId,
    organizationId,
    ...(branchScope ? { branchId: branchScope } : {}),
  }).lean();
  if (!issue) throw new AppError("gazette_not_found", 404);

  const [branch, items] = await Promise.all([
    Branch.findById(issue.branchId).select("name timezone").lean(),
    FamilyGazetteItem.find({ issueId: issue._id })
      .select(
        "residentId familyCount messageCount overCap status printedAt pdfKey",
      )
      .lean(),
  ]);
  const residents = await Resident.find({
    _id: { $in: items.map((item) => item.residentId) },
  })
    .select("name roomNumber")
    .lean();
  const byId = new Map(
    residents.map((resident) => [String(resident._id), resident]),
  );
  const rows = items
    .map((item) => ({
      itemId: item._id,
      ...issuedRow(item, byId.get(String(item.residentId)), issue.messageCap),
      hasPdf: Boolean(item.pdfKey),
      printedAt: item.printedAt || null,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  const total = rows.length;
  const count = (status) => rows.filter((row) => row.status === status).length;
  const counts = {
    total,
    ready: count("ready"),
    noContent: count("noContent"),
    overCap: count("overCap"),
    noFamily: count("noFamily"),
    printed: count("printed"),
    building: count("building"),
    failed: count("failed"),
  };
  const timezone = branch?.timezone || "Europe/London";

  return {
    gazette: {
      gazetteId: issue._id,
      branchId: issue.branchId,
      homeName: branch?.name || "",
      number: issue.number,
      status: issue.status,
      periodStart: issue.periodStart,
      periodEnd: issue.periodEnd,
      closesAt: issue.closesAt,
      generatedAt: issue.generatedAt || null,
      messageCap: issue.messageCap,
      title: `Gazette No. ${issue.number} - Closes ${shortDate(issue.closesAt, timezone)}`,
      residentsLabel: plural(total, "Resident"),
      counts,
      countsLabel: gazetteCountsLabel(counts, issue.messageCap),
    },
    noContent: noContentNotice(counts.noContent),
    residents: rows.slice(skip, skip + limit),
    meta: generateMeta(page, limit, total),
  };
};

const listTagOptions = async ({ actor, organizationId, branchId }) => {
  const site = await siteOf({ actor, organizationId, branchId });
  const residents = await Resident.find({
    organizationId,
    branchId: site.branchId,
    admissionStatus: AdmissionStatus.ADMITTED,
  })
    .sort({ name: 1, _id: 1 })
    .select("name roomNumber photoUrl photographyConsent")
    .lean();
  return residents.map((resident) => {
    const canTag = Boolean(resident.photographyConsent);
    return {
      residentId: resident._id,
      name: resident.name,
      roomNumber: resident.roomNumber || "",
      photoUrl: resident.photoUrl || "",
      canTag,
      label: canTag ? resident.name : `${resident.name} - No Photo Consent`,
    };
  });
};

const firstHighlightPhoto = (newsletter) =>
  newsletter.highlights.find((item) => item.photoUrl)?.photoUrl ||
  newsletter.gallery.find((item) => item.url)?.url ||
  "";

const noticeKey = (notice, index) => notice.storyId || `n${index}`;

const storiesOf = (newsletter) => [
  ...(newsletter.sections.welcome && newsletter.welcome?.text
    ? [
        {
          storyId: "welcome",
          type: "welcome",
          headline: "Message From The Manager",
          story: newsletter.welcome.text,
          mediaId: null,
          photoUrl: "",
          subtitle: "Text Only",
        },
      ]
    : []),
  ...newsletter.highlights.map((item) => ({
    storyId: `post-${item.postId}`,
    type: "wallPost",
    headline: item.title,
    story: item.text,
    postId: item.postId,
    mediaId: item.mediaId || null,
    photoUrl: item.photoUrl || "",
    subtitle: "From A Wall Post",
  })),
  ...newsletter.notices.map((item, index) => ({
    storyId: `story-${noticeKey(item, index)}`,
    type: "story",
    headline: item.title,
    story: item.body,
    mediaId: item.mediaId || null,
    photoUrl: item.photoUrl || "",
    subtitle: item.mediaId ? "With Photo" : "Text Only",
  })),
];

const presentNewsletter = (newsletter) => {
  const stories = storiesOf(newsletter);
  const fromPosts = stories.filter((story) => story.type === "wallPost").length;
  return {
    newsletterId: newsletter.newsletterId,
    branchId: newsletter.branchId,
    homeName: newsletter.homeName,
    title: newsletter.title,
    month: newsletter.month,
    periodLabel: newsletter.periodLabel,
    status: newsletter.status,
    badge: newsletterStatusLabel(newsletter.status),
    editable: newsletter.status === FamilyNewsletterStatus.DRAFT,
    coverPhotoUrl: firstHighlightPhoto(newsletter),
    storiesLabel: `${stories.length} ${stories.length === 1 ? "Story" : "Stories"} - ${fromPosts} From Wall Posts`,
    stories,
    recipients: newsletter.recipients,
  };
};

const latestNewsletterId = async ({ organizationId, branchId }) => {
  const scope = {
    organizationId: toObjectId(organizationId),
    branchId: toObjectId(branchId),
  };
  const row =
    (await FamilyNewsletter.findOne({
      ...scope,
      status: FamilyNewsletterStatus.DRAFT,
    })
      .sort({ periodStart: -1 })
      .select("_id")
      .lean()) ||
    (await FamilyNewsletter.findOne(scope)
      .sort({ periodStart: -1 })
      .select("_id")
      .lean());
  return row?._id || null;
};

const getNewsletterScreen = async ({ actor, organizationId, branchId }) => {
  const site = await siteOf({ actor, organizationId, branchId });
  const newsletterId = await latestNewsletterId({
    organizationId,
    branchId: site.branchId,
  });
  if (!newsletterId) return { homeName: site.name, newsletter: null };
  const newsletter = await newsletterService.getNewsletter({
    organizationId,
    branchId: site.branchId,
    newsletterId,
  });
  return { homeName: site.name, newsletter: presentNewsletter(newsletter) };
};

const createNewsletter = async ({
  actor,
  organizationId,
  branchId,
  month,
  title,
  now = new Date(),
}) => {
  const site = await siteOf({ actor, organizationId, branchId });
  const current = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    timeZone: site.timezone,
  })
    .format(now)
    .slice(0, 7);
  const created = await newsletterService.createDraft({
    actor,
    organizationId,
    branchId: site.branchId,
    month: month === undefined ? current : month,
    title,
  });
  return { homeName: site.name, newsletter: presentNewsletter(created) };
};

const loadNewsletter = ({ organizationId, branchScope, newsletterId }) =>
  newsletterService.getNewsletter({
    organizationId,
    branchId: branchScope || undefined,
    newsletterId,
  });

const getStory = async ({
  organizationId,
  branchScope,
  newsletterId,
  storyId,
}) => {
  const newsletter = await loadNewsletter({
    organizationId,
    branchScope,
    newsletterId,
  });
  const story = storiesOf(newsletter).find((item) => item.storyId === storyId);
  if (!story) throw new AppError("newsletter_story_not_found", 404);
  return { newsletterId: newsletter.newsletterId, ...story };
};

const listAddablePosts = async ({
  organizationId,
  branchScope,
  newsletterId,
  page,
  limit,
  skip,
}) => {
  const newsletter = await loadNewsletter({
    organizationId,
    branchScope,
    newsletterId,
  });
  const used = newsletter.highlights.map((item) => item.postId);
  const [result] = await FamilyPost.aggregate([
    ...publishedPostsOfSite({ organizationId, branchId: newsletter.branchId }),
    { $match: { _id: { $nin: used } } },
    { $sort: { createdAt: -1, _id: -1 } },
    {
      $facet: {
        data: [
          { $skip: skip },
          { $limit: limit },
          {
            $lookup: {
              from: FamilyReaction.collection.name,
              localField: "_id",
              foreignField: "postId",
              as: "reactions",
            },
          },
          {
            $lookup: {
              from: FamilyMedia.collection.name,
              localField: "mediaIds",
              foreignField: "_id",
              as: "media",
            },
          },
          {
            $project: {
              title: 1,
              message: 1,
              createdAt: 1,
              reactionCount: { $size: "$reactions" },
              photoUrl: { $ifNull: [{ $arrayElemAt: ["$media.url", 0] }, ""] },
            },
          },
        ],
        totalCount: [{ $count: "count" }],
      },
    },
  ]);

  return {
    data: result.data.map((post) => {
      const headline =
        post.title ||
        String(post.message || "")
          .split(/\r?\n/)[0]
          .slice(0, 120);
      return {
        postId: post._id,
        headline,
        createdAt: post.createdAt,
        reactionCount: post.reactionCount,
        photoUrl: post.photoUrl,
        subtitle: `${shortDate(post.createdAt)} - ${plural(post.reactionCount, "Reaction")}`,
      };
    }),
    meta: generateMeta(page, limit, result.totalCount[0]?.count || 0),
  };
};

const keptHighlights = (newsletter) =>
  newsletter.highlights.map(({ postId, title, text, mediaId }) => ({
    postId: String(postId),
    title,
    text,
    mediaId: mediaId ? String(mediaId) : null,
  }));

const keptNotices = (newsletter) =>
  newsletter.notices.map((item, index) => ({
    storyId: noticeKey(item, index),
    title: item.title,
    body: item.body,
    mediaId: item.mediaId ? String(item.mediaId) : null,
  }));

const save = async ({ actor, organizationId, newsletterId, patch }) => {
  const updated = await newsletterService.updateDraft({
    actor,
    organizationId,
    newsletterId,
    ...patch,
  });
  return presentNewsletter(updated);
};

const storyText = (value, max) => {
  const text = String(value ?? "").trim();
  if (text.length > max)
    throw new AppError("newsletter_story_text_too_long", 400, { max });
  return text;
};

const addStory = async ({
  actor,
  organizationId,
  branchScope,
  newsletterId,
  postId,
  headline,
  story,
  mediaId,
}) => {
  const newsletter = await loadNewsletter({
    organizationId,
    branchScope,
    newsletterId,
  });

  if (postId !== undefined) {
    if (!isValidObjectId(postId))
      throw new AppError("newsletter_post_invalid", 400);
    if (
      newsletter.highlights.some(
        (item) => String(item.postId) === String(postId),
      )
    )
      throw new AppError("newsletter_story_exists", 409);
    if (newsletter.highlights.length >= MAX_HIGHLIGHTS)
      throw new AppError("newsletter_stories_full", 409);
    const [post] = await FamilyPost.aggregate([
      ...publishedPostsOfSite({
        organizationId,
        branchId: newsletter.branchId,
      }),
      { $match: { _id: toObjectId(postId) } },
      { $project: { title: 1, message: 1, mediaIds: 1, createdAt: 1 } },
    ]);
    if (!post) throw new AppError("newsletter_post_invalid", 400);
    const filled = newsletterService.highlightFromPost(post);
    const added = {
      postId: String(post._id),
      title: headline === undefined ? post.title || filled.title : headline,
      text:
        story === undefined
          ? filled.text
          : storyText(story, MAX_POST_STORY_TEXT),
      mediaId: filled.mediaId ? String(filled.mediaId) : null,
    };
    return save({
      actor,
      organizationId,
      newsletterId,
      patch: { highlights: [...keptHighlights(newsletter), added] },
    });
  }

  if (newsletter.notices.length >= MAX_NOTICES)
    throw new AppError("newsletter_stories_full", 409);
  const notices = keptNotices(newsletter);
  let next = notices.length;
  while (notices.some((item) => item.storyId === `n${next}`)) next += 1;
  return save({
    actor,
    organizationId,
    newsletterId,
    patch: {
      notices: [
        ...notices,
        {
          storyId: `n${next}`,
          title: headline,
          body: storyText(story, MAX_STORY_TEXT),
          mediaId: mediaId || null,
        },
      ],
    },
  });
};

const changeStory = async ({
  actor,
  organizationId,
  branchScope,
  newsletterId,
  storyId,
  change,
}) => {
  const newsletter = await loadNewsletter({
    organizationId,
    branchScope,
    newsletterId,
  });
  const found = storiesOf(newsletter).find((item) => item.storyId === storyId);
  if (!found) throw new AppError("newsletter_story_not_found", 404);
  const patch = change(newsletter, found);
  if (!patch) return presentNewsletter(newsletter);
  return save({ actor, organizationId, newsletterId, patch });
};

const updateStory = ({ headline, story, mediaId, ...scope }) =>
  changeStory({
    ...scope,
    change: (newsletter, found) => {
      if (
        headline === undefined &&
        story === undefined &&
        mediaId === undefined
      )
        throw new AppError("nothing_to_update", 400);
      const unchanged =
        (headline === undefined ||
          String(headline).trim() === found.headline) &&
        (story === undefined || String(story).trim() === found.story) &&
        (mediaId === undefined ||
          String(mediaId || "") === String(found.mediaId || ""));
      if (unchanged) return null;

      if (found.type === "welcome") {
        if ((headline !== undefined && headline !== found.headline) || mediaId)
          throw new AppError("newsletter_headline_fixed", 400);
        return { welcome: { text: story } };
      }
      const changes = {
        ...(headline === undefined ? {} : { title: headline }),
        ...(mediaId === undefined ? {} : { mediaId: mediaId || null }),
      };
      if (found.type === "wallPost") {
        const text =
          story === undefined
            ? {}
            : { text: storyText(story, MAX_POST_STORY_TEXT) };
        return {
          highlights: keptHighlights(newsletter).map((item) =>
            `post-${item.postId}` === found.storyId
              ? { ...item, ...changes, ...text }
              : item,
          ),
        };
      }
      const body =
        story === undefined ? {} : { body: storyText(story, MAX_STORY_TEXT) };
      return {
        notices: keptNotices(newsletter).map((item) =>
          `story-${item.storyId}` === found.storyId
            ? { ...item, ...changes, ...body }
            : item,
        ),
      };
    },
  });

const removeStory = (scope) =>
  changeStory({
    ...scope,
    change: (newsletter, found) => {
      if (found.type === "welcome") return { welcome: { text: "" } };
      if (found.type === "wallPost") {
        return {
          highlights: keptHighlights(newsletter).filter(
            (item) => `post-${item.postId}` !== found.storyId,
          ),
        };
      }
      return {
        notices: keptNotices(newsletter).filter(
          (item) => `story-${item.storyId}` !== found.storyId,
        ),
      };
    },
  });

const addPostToDraft = async ({ actor, organizationId, post }) => {
  if (post.status && post.status !== FamilyPostStatus.PUBLISHED)
    return { added: false, reason: "postNotPublished" };
  const draft = await FamilyNewsletter.findOne({
    organizationId: toObjectId(organizationId),
    branchId: toObjectId(post.branchId),
    status: FamilyNewsletterStatus.DRAFT,
  })
    .sort({ periodStart: -1 })
    .select("_id")
    .lean();
  if (!draft) return { added: false, reason: "noDraft" };
  try {
    await addStory({
      actor,
      organizationId,
      newsletterId: draft._id,
      postId: String(post.postId),
    });
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return {
      added: false,
      reason: error.translationKey || error.message,
      newsletterId: draft._id,
    };
  }
  return { added: true, newsletterId: draft._id };
};

const createPost = async ({
  actor,
  organizationId,
  addToNewsletter,
  ...fields
}) => {
  if (addToNewsletter !== undefined && typeof addToNewsletter !== "boolean")
    throw new AppError("invalid_add_to_newsletter", 400);
  const post = await familyPostService.createPost({
    actor,
    organizationId,
    ...fields,
  });
  if (!addToNewsletter) return post;
  return {
    ...post,
    newsletter: await addPostToDraft({ actor, organizationId, post }),
  };
};

module.exports = {
  getHome,
  getGazette,
  getGazetteDetail,
  listTagOptions,
  createPost,
  getNewsletterScreen,
  createNewsletter,
  getStory,
  listAddablePosts,
  addStory,
  updateStory,
  removeStory,
};
