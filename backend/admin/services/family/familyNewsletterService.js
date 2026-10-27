const moment = require("moment-timezone");
const { User } = require("@models/UserModel");
const { Branch } = require("@models/Branch");
const { Organization } = require("@models/Organization");
const { Resident } = require("@models/Resident");
const { FamilyPost } = require("@models/FamilyPost");
const { FamilyMedia } = require("@models/FamilyMedia");
const { FamilyMember } = require("@models/FamilyMember");
const { FamilyNewsletter } = require("@models/FamilyNewsletter");
const {
  AdmissionStatus,
  FamilyMemberStatus,
  FamilyNewsletterStatus,
  FamilyPostStatus,
  MembershipRole,
} = require("@models/domainEnums");
const { paginateWithFacet, keywordOr } = require("@utils/paginate");
const { searchText } = require("@utils/familyQuery");
const { NotificationExp } = require("@models/Notifications");
const uploadAwsService = require("@commonServices/uploads/uploadAwsService");
const { renderNewsletterPdf } = require("./familyNewsletterPdf");
const { sendNewsletterEmails } = require("./familyNewsletterEmail");
const { AppError } = require("@services/_errors/AppError");
const { toObjectId, isValidObjectId, joinOne } = require("@appServices/family/familyPipeline");
const { resolveSite, assertMayChangeSite } = require("./familySite");

const MAX_HIGHLIGHTS = 12;
const MAX_COMING_UP = 20;
const MAX_NOTICES = 10;
const MAX_GALLERY = 6;
const MAX_NEW_RESIDENTS = 20;
const MAX_TITLE = 120;
const MAX_WELCOME = 2000;
const MAX_HIGHLIGHT_TEXT = 1000;
const MAX_NOTICE_BODY = 500;
const MAX_CAPTION = 80;
const MAX_COMING_UP_DESCRIPTION = 200;
const MAX_CATEGORY = 30;
const TEMPLATES = ["classic"];
const MAX_FOOTER = 200;
const MONTH_FORMAT = /^\d{4}-(0[1-9]|1[0-2])$/;
const TIME_FORMAT = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISSUE_RETRIES = 3;
const MAX_SCHEDULE_DAYS = 365;
const DUE_PER_RUN = 20;
const NOTIFY_CHUNK = 1000;
const DEFAULT_NOTICES = [
  {
    title: "Share your photos",
    body: "Send photos to your relative through the app and they will appear in their family gazette.",
  },
];
const REFILLABLE = ["highlights", "gallery", "newResidents"];
const STUCK_AFTER_MS = 15 * 60 * 1000;
const CHANNELS = ["inApp", "email", "pdf"];

const ROLE_LABELS = {
  [MembershipRole.OWNER]: "Owner",
  [MembershipRole.SUPER_ADMIN]: "Owner",
  [MembershipRole.SITE_MANAGER]: "Site Manager",
  [MembershipRole.LINE_MANAGER]: "Line Manager",
};

const isDuplicateKey = (error) => error?.code === 11000;

/** BR-06: a resident with photo sharing off never appears in a newsletter, even if the post was tagged before. */
const everyTaggedResidentConsents = {
  $expr: {
    $allElementsTrue: [
      { $map: { input: "$tagged", as: "resident", in: { $eq: ["$$resident.photographyConsent", true] } } },
    ],
  },
};

const publishedPostsOfSite = ({ organizationId, branchId }) => [
  {
    $match: {
      organizationId: toObjectId(organizationId),
      branchId: toObjectId(branchId),
      status: FamilyPostStatus.PUBLISHED,
    },
  },
  { $lookup: { from: Resident.collection.name, localField: "taggedResidentIds", foreignField: "_id", as: "tagged" } },
  { $match: everyTaggedResidentConsents },
];

const firstLine = (message) => String(message || "").split(/\r?\n/).find((line) => line.trim()) || "";

const cut = (text, max) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

/** The post's first line becomes the title and the rest the text; a single line is used for both. */
const highlightFromPost = (post) => {
  const lines = String(post.message || "").trim().split(/\r?\n/).filter((line) => line.trim());
  const title = cut(firstLine(post.message).trim(), MAX_TITLE);
  const text = lines.length > 1 ? lines.slice(1).join("\n") : lines[0] || "";
  return {
    postId: post._id,
    title,
    text: cut(text, MAX_HIGHLIGHT_TEXT),
    mediaId: post.mediaIds?.[0] || null,
    postedAt: post.createdAt,
  };
};

const monthWindow = (month, timezone) => {
  const start = moment.tz(`${month}-01`, "YYYY-MM-DD", timezone).startOf("month");
  return { start: start.toDate(), end: start.clone().endOf("month").toDate(), label: start.format("MMMM") };
};

const shortName = (name) => {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] || "";
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
};

const formatAddress = (address) => {
  if (!address) return "";
  if (typeof address === "string") return address.trim();
  return Object.values(address).filter((part) => typeof part === "string" && part.trim()).join(", ");
};

const plainText = (value, { max, required = false }) => {
  if (value === undefined || value === null) {
    if (required) throw new AppError("newsletter_text_required", 400);
    return "";
  }
  if (typeof value !== "string") throw new AppError("newsletter_text_invalid", 400);
  const text = value.trim();
  if (required && !text) throw new AppError("newsletter_text_required", 400);
  if (text.length > max) throw new AppError("newsletter_text_too_long", 400, { max });
  return text;
};

const objectList = (value, max) => {
  if (!Array.isArray(value) || value.some((item) => !item || typeof item !== "object" || Array.isArray(item))) {
    throw new AppError("newsletter_list_invalid", 400);
  }
  if (value.length > max) throw new AppError("newsletter_list_too_long", 400, { max });
  return value;
};

const uniqueIds = (ids, errorKey) => {
  const unique = new Set(ids.map(String));
  if (unique.size !== ids.length || !ids.every((id) => isValidObjectId(String(id)))) {
    throw new AppError(errorKey, 400);
  }
};

const checkSections = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AppError("newsletter_sections_invalid", 400);
  const allowed = Object.keys(FamilyNewsletter.schema.paths)
    .filter((path) => path.startsWith("sections."))
    .map((path) => path.slice("sections.".length));
  const set = {};
  for (const [key, flag] of Object.entries(value)) {
    if (!allowed.includes(key) || typeof flag !== "boolean") throw new AppError("newsletter_sections_invalid", 400);
    set[`sections.${key}`] = flag;
  }
  return set;
};

const checkComingUp = (value) => {
  const items = objectList(value, MAX_COMING_UP).map((item) => {
    const date = moment.utc(item.date, moment.ISO_8601, true);
    if (!date.isValid()) throw new AppError("newsletter_date_invalid", 400);
    const time = item.time === undefined || item.time === "" ? "" : String(item.time);
    if (time && !TIME_FORMAT.test(time)) throw new AppError("newsletter_time_invalid", 400);
    return {
      date: date.toDate(),
      time,
      title: plainText(item.title, { max: MAX_TITLE, required: true }),
      description: plainText(item.description, { max: MAX_COMING_UP_DESCRIPTION }),
      category: plainText(item.category, { max: MAX_CATEGORY }),
    };
  });
  return items.sort((a, b) => a.date - b.date || a.time.localeCompare(b.time));
};

const checkNotices = (value) =>
  objectList(value, MAX_NOTICES).map((item) => ({
    title: plainText(item.title, { max: MAX_TITLE, required: true }),
    body: plainText(item.body, { max: MAX_NOTICE_BODY }),
  }));

const checkDelivery = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AppError("newsletter_delivery_invalid", 400);
  const set = {};
  for (const [key, flag] of Object.entries(value)) {
    if (!["inApp", "email", "pdf"].includes(key) || typeof flag !== "boolean") throw new AppError("newsletter_delivery_invalid", 400);
    set[`delivery.${key}`] = flag;
  }
  return set;
};

const checkTemplate = (value) => {
  if (!TEMPLATES.includes(value)) throw new AppError("newsletter_template_invalid", 400, { templates: TEMPLATES.join(", ") });
  return value;
};

const checkFooter = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AppError("newsletter_footer_invalid", 400);
  const set = {};
  for (const key of ["homeName", "address", "phone", "email"]) {
    if (value[key] !== undefined) set[`footer.${key}`] = plainText(value[key], { max: MAX_FOOTER });
  }
  return set;
};

/** Highlights must be live posts of this site, and a photo must belong to its own post. */
const checkHighlights = async ({ value, organizationId, branchId }) => {
  const items = objectList(value, MAX_HIGHLIGHTS);
  const postIds = items.map((item) => String(item.postId));
  uniqueIds(postIds, "newsletter_post_invalid");

  const posts = postIds.length
    ? await FamilyPost.aggregate([
        ...publishedPostsOfSite({ organizationId, branchId }),
        { $match: { _id: { $in: postIds.map(toObjectId) } } },
        { $project: { mediaIds: 1, createdAt: 1 } },
      ])
    : [];
  const byId = new Map(posts.map((post) => [String(post._id), post]));

  return items.map((item) => {
    const post = byId.get(String(item.postId));
    if (!post) throw new AppError("newsletter_post_invalid", 400);

    const mediaId = item.mediaId ? String(item.mediaId) : null;
    if (mediaId && !post.mediaIds.some((id) => String(id) === mediaId)) throw new AppError("newsletter_media_invalid", 400);

    return {
      postId: post._id,
      title: plainText(item.title, { max: MAX_TITLE }),
      text: plainText(item.text, { max: MAX_HIGHLIGHT_TEXT }),
      mediaId: mediaId ? toObjectId(mediaId) : null,
      postedAt: post.createdAt,
    };
  });
};

/** Gallery photos must come from live, consented wall posts of this site. */
const checkGallery = async ({ value, organizationId, branchId }) => {
  const items = objectList(value, MAX_GALLERY);
  const mediaIds = items.map((item) => String(item.mediaId));
  uniqueIds(mediaIds, "newsletter_media_invalid");

  if (mediaIds.length) {
    const found = await FamilyPost.aggregate([
      ...publishedPostsOfSite({ organizationId, branchId }),
      { $unwind: "$mediaIds" },
      { $match: { mediaIds: { $in: mediaIds.map(toObjectId) } } },
      { $group: { _id: "$mediaIds" } },
    ]);
    if (found.length !== mediaIds.length) throw new AppError("newsletter_media_invalid", 400);
  }

  return items.map((item) => ({
    mediaId: toObjectId(item.mediaId),
    caption: plainText(item.caption, { max: MAX_CAPTION }),
  }));
};

/** New residents are named to every family, so only residents of this site with photo sharing on may be listed. */
const checkNewResidents = async ({ value, organizationId, branchId }) => {
  if (!Array.isArray(value)) throw new AppError("newsletter_list_invalid", 400);
  if (value.length > MAX_NEW_RESIDENTS) throw new AppError("newsletter_list_too_long", 400, { max: MAX_NEW_RESIDENTS });
  uniqueIds(value, "newsletter_resident_invalid");

  const residents = value.length
    ? await Resident.aggregate([
        {
          $match: {
            _id: { $in: value.map(toObjectId) },
            organizationId: toObjectId(organizationId),
            branchId: toObjectId(branchId),
            admissionStatus: AdmissionStatus.ADMITTED,
            photographyConsent: true,
          },
        },
        { $project: { name: 1, roomNumber: 1 } },
      ])
    : [];
  if (residents.length !== value.length) throw new AppError("newsletter_resident_invalid", 400);

  const byId = new Map(residents.map((resident) => [String(resident._id), resident]));
  return value.map((id) => {
    const resident = byId.get(String(id));
    return { residentId: resident._id, name: shortName(resident.name), roomNumber: resident.roomNumber || "" };
  });
};

const statusCountsOf = (rows = []) => {
  const counts = Object.fromEntries(Object.values(FamilyNewsletterStatus).map((status) => [status, 0]));
  rows.forEach((row) => {
    counts[row._id] = row.count;
  });
  return counts;
};

/** Families and people the newsletter would reach: everyone actively linked at the site. */
const recipientsOf = async ({ organizationId, branchId }) => {
  const [row] = await FamilyMember.aggregate([
    {
      $match: {
        organizationId: toObjectId(organizationId),
        branchId: toObjectId(branchId),
        status: FamilyMemberStatus.ACTIVE,
      },
    },
    { $group: { _id: null, residents: { $addToSet: "$residentId" }, members: { $addToSet: "$userId" } } },
    { $project: { _id: 0, families: { $size: "$residents" }, members: { $size: "$members" } } },
  ]);
  return row || { families: 0, members: 0 };
};

const getNewsletter = async ({ organizationId, newsletterId }) => {
  if (!isValidObjectId(newsletterId)) throw new AppError("newsletter_not_found", 404);

  const [newsletter] = await FamilyNewsletter.aggregate([
    { $match: { _id: toObjectId(newsletterId), organizationId: toObjectId(organizationId) } },
    ...joinOne({ from: User, localField: "authorId", as: "author", optional: true }),
    ...joinOne({ from: Branch, localField: "branchId", as: "branch", optional: true }),
    { $addFields: { authorName: { $ifNull: ["$author.name", ""] }, homeName: { $ifNull: ["$branch.name", ""] } } },
    { $project: { author: 0, branch: 0, pdfKey: 0 } },
  ]);
  if (!newsletter) throw new AppError("newsletter_not_found", 404);
  const [organization] = await Organization.aggregate([{ $match: { _id: newsletter.organizationId } }, { $project: { name: 1 } }]);

  const mediaIds = [...newsletter.highlights.map((h) => h.mediaId), ...newsletter.gallery.map((g) => g.mediaId)].filter(Boolean);
  const media = mediaIds.length
    ? await FamilyMedia.aggregate([{ $match: { _id: { $in: mediaIds } } }, { $project: { url: 1 } }])
    : [];
  const urlOf = new Map(media.map((item) => [String(item._id), item.url]));
  const photoUrl = (id) => (id ? urlOf.get(String(id)) || "" : "");

  const { _id, ...rest } = newsletter;
  return {
    newsletterId: _id,
    ...rest,
    organizationName: organization?.name || "",
    periodLabel: moment.utc(`${newsletter.month}-01`).format("MMMM YYYY"),
    counts: {
      highlights: newsletter.highlights.length,
      comingUp: newsletter.comingUp.length,
      notices: newsletter.notices.length,
      newResidents: newsletter.newResidents.length,
      gallery: newsletter.gallery.length,
    },
    highlights: newsletter.highlights.map((h) => ({ ...h, photoUrl: photoUrl(h.mediaId) })),
    gallery: newsletter.gallery.map((g) => ({ ...g, url: photoUrl(g.mediaId) })),
    recipients: await recipientsOf({ organizationId, branchId: newsletter.branchId }),
  };
};

/** Newest month first; meta.counts covers every status and ignores the status filter. */
const listNewsletters = async ({ organizationId, branchId, status, month, keyword, page, limit, skip }) => {
  if (status && !Object.values(FamilyNewsletterStatus).includes(status)) throw new AppError("invalid_status_filter", 400);
  if (month && !MONTH_FORMAT.test(month)) throw new AppError("newsletter_month_invalid", 400);

  const base = { organizationId: toObjectId(organizationId) };
  if (branchId) base.branchId = toObjectId(branchId);
  if (month) base.month = month;
  const or = keywordOr(searchText(keyword), ["title"], { trim: true });
  if (or) base.$or = or;

  const { result, data, meta } = await paginateWithFacet({
    model: FamilyNewsletter,
    match: status ? { ...base, status } : base,
    page,
    limit,
    skip,
    sort: { month: -1, createdAt: -1 },
    extraFacets: {
      statusCounts: [{ $match: base }, { $group: { _id: "$status", count: { $sum: 1 } } }],
    },
    extraDataStages: [
      ...joinOne({ from: User, localField: "authorId", as: "author", optional: true }),
      ...joinOne({ from: Branch, localField: "branchId", as: "branch", optional: true }),
      {
        $project: {
          _id: 0,
          newsletterId: "$_id",
          branchId: 1,
          homeName: { $ifNull: ["$branch.name", ""] },
          title: 1,
          month: 1,
          issueNumber: 1,
          status: 1,
          authorName: { $ifNull: ["$author.name", ""] },
          highlightsCount: { $size: "$highlights" },
          sendAt: 1,
          sentAt: 1,
          createdAt: 1,
        },
      },
    ],
  });

  return { data, meta: { ...meta, counts: statusCountsOf(result.statusCounts) } };
};

const autoFill = async ({ organizationId, branchId, start, end }) => {
  const posts = await FamilyPost.aggregate([
    ...publishedPostsOfSite({ organizationId, branchId }),
    { $match: { createdAt: { $gte: start, $lte: end } } },
    { $sort: { createdAt: 1, _id: 1 } },
    { $limit: MAX_HIGHLIGHTS },
    { $project: { message: 1, mediaIds: 1, createdAt: 1 } },
  ]);
  const highlights = posts.map(highlightFromPost);

  const gallery = highlights
    .filter((highlight) => highlight.mediaId)
    .slice(0, MAX_GALLERY)
    .map((highlight) => ({ mediaId: highlight.mediaId, caption: cut(highlight.title, MAX_CAPTION) }));

  const arrivals = await Resident.aggregate([
    {
      $match: {
        organizationId: toObjectId(organizationId),
        branchId: toObjectId(branchId),
        admissionStatus: AdmissionStatus.ADMITTED,
        photographyConsent: true,
        admittedAt: { $gte: start, $lte: end },
      },
    },
    { $sort: { admittedAt: 1, _id: 1 } },
    { $limit: MAX_NEW_RESIDENTS },
    { $project: { name: 1, roomNumber: 1 } },
  ]);
  const newResidents = arrivals.map((resident) => ({
    residentId: resident._id,
    name: shortName(resident.name),
    roomNumber: resident.roomNumber || "",
  }));

  return { highlights, gallery, newResidents };
};

const nextIssueNumber = async (branchId) => {
  const [row] = await FamilyNewsletter.aggregate([
    { $match: { branchId: toObjectId(branchId) } },
    { $group: { _id: null, latest: { $max: "$issueNumber" } } },
  ]);
  return (row?.latest ?? 0) + 1;
};

/** A draft for one site and month, filled in from the month's wall posts, ready to edit. */
const createDraft = async ({ actor, organizationId, branchId, month, title, template }) => {
  const site = await resolveSite({ actor, organizationId, branchId });
  if (typeof month !== "string" || !MONTH_FORMAT.test(month)) throw new AppError("newsletter_month_invalid", 400);

  const [branch] = await Branch.aggregate([
    { $match: { _id: toObjectId(site.branchId) } },
    { $project: { name: 1, timezone: 1, address: 1 } },
  ]);
  const window = monthWindow(month, branch.timezone || "Europe/London");

  const [existing] = await FamilyNewsletter.aggregate([
    { $match: { branchId: toObjectId(site.branchId), month } },
    { $project: { _id: 1 } },
  ]);
  if (existing) throw new AppError("newsletter_exists_for_month", 409);

  const filled = await autoFill({ organizationId, branchId: site.branchId, ...window });
  const homeName = branch.name || "";

  for (let attempt = 0; attempt < ISSUE_RETRIES; attempt += 1) {
    try {
      const created = await FamilyNewsletter.create({
        organizationId,
        branchId: site.branchId,
        authorId: actor._id,
        month,
        periodStart: window.start,
        periodEnd: window.end,
        issueNumber: await nextIssueNumber(site.branchId),
        title: title === undefined ? `${window.label} newsletter` : plainText(title, { max: MAX_TITLE, required: true }),
        template: template === undefined ? TEMPLATES[0] : checkTemplate(template),
        notices: DEFAULT_NOTICES,
        welcome: { text: `Welcome to our ${window.label} newsletter.`, signedBy: [actor.name, ROLE_LABELS[site.standing.role]].filter(Boolean).join(", ") },
        footer: { homeName, address: formatAddress(branch.address), phone: "", email: "" },
        ...filled,
      });
      return getNewsletter({ organizationId, newsletterId: created._id });
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      const clash = String(error.message || "");
      if (clash.includes("month")) throw new AppError("newsletter_exists_for_month", 409);
    }
  }
  throw new AppError("newsletter_exists_for_month", 409);
};

const loadDraft = async ({ actor, organizationId, newsletterId }) => {
  if (!isValidObjectId(newsletterId)) throw new AppError("newsletter_not_found", 404);

  const [newsletter] = await FamilyNewsletter.aggregate([
    { $match: { _id: toObjectId(newsletterId), organizationId: toObjectId(organizationId) } },
    { $project: { branchId: 1, status: 1, periodStart: 1, periodEnd: 1 } },
  ]);
  if (!newsletter) throw new AppError("newsletter_not_found", 404);

  await assertMayChangeSite({ actor, organizationId, branchId: newsletter.branchId });
  if (newsletter.status !== FamilyNewsletterStatus.DRAFT) throw new AppError("newsletter_not_editable", 409);
  return newsletter;
};

/** Only what is sent is changed; every list sent replaces the whole list. */
const updateDraft = async ({ actor, organizationId, newsletterId, ...patch }) => {
  const draft = await loadDraft({ actor, organizationId, newsletterId });
  const site = { organizationId, branchId: draft.branchId };
  const set = {};

  if (patch.refill !== undefined) {
    if (!Array.isArray(patch.refill) || !patch.refill.length || new Set(patch.refill).size !== patch.refill.length || patch.refill.some((name) => !REFILLABLE.includes(name))) {
      throw new AppError("newsletter_refill_invalid", 400, { sections: REFILLABLE.join(", ") });
    }
    const fresh = await autoFill({ ...site, start: draft.periodStart, end: draft.periodEnd });
    patch.refill.forEach((name) => {
      set[name] = fresh[name];
    });
  }
  if (patch.title !== undefined) set.title = plainText(patch.title, { max: MAX_TITLE, required: true });
  if (patch.sections !== undefined) Object.assign(set, checkSections(patch.sections));
  if (patch.welcome !== undefined) {
    if (!patch.welcome || typeof patch.welcome !== "object" || Array.isArray(patch.welcome)) throw new AppError("newsletter_welcome_invalid", 400);
    if (patch.welcome.text !== undefined) set["welcome.text"] = plainText(patch.welcome.text, { max: MAX_WELCOME });
    if (patch.welcome.signedBy !== undefined) set["welcome.signedBy"] = plainText(patch.welcome.signedBy, { max: MAX_TITLE });
  }
  if (patch.highlights !== undefined) set.highlights = await checkHighlights({ value: patch.highlights, ...site });
  if (patch.comingUp !== undefined) set.comingUp = checkComingUp(patch.comingUp);
  if (patch.notices !== undefined) set.notices = checkNotices(patch.notices);
  if (patch.newResidentIds !== undefined) set.newResidents = await checkNewResidents({ value: patch.newResidentIds, ...site });
  if (patch.gallery !== undefined) set.gallery = await checkGallery({ value: patch.gallery, ...site });
  if (patch.footer !== undefined) Object.assign(set, checkFooter(patch.footer));
  if (patch.delivery !== undefined) Object.assign(set, checkDelivery(patch.delivery));
  if (patch.template !== undefined) set.template = checkTemplate(patch.template);

  if (!Object.keys(set).length) throw new AppError("nothing_to_update", 400);

  const updated = await FamilyNewsletter.updateOne(
    { _id: draft._id, status: FamilyNewsletterStatus.DRAFT },
    { $set: set }
  );
  if (!updated.modifiedCount) throw new AppError("newsletter_not_editable", 409);

  return getNewsletter({ organizationId, newsletterId });
};

/** A draft can be thrown away, which frees its month; a sent newsletter stays as the record. */
const deleteDraft = async ({ actor, organizationId, newsletterId }) => {
  const draft = await loadDraft({ actor, organizationId, newsletterId });

  const removed = await FamilyNewsletter.deleteOne({ _id: draft._id, status: FamilyNewsletterStatus.DRAFT });
  if (!removed.deletedCount) throw new AppError("newsletter_not_editable", 409);

  return { newsletterId: draft._id, deleted: true };
};

/** A schedule is a date and time in the future, no more than a year away. */
const parseSendAt = (value) => {
  const when = typeof value === "string" ? moment.utc(value, moment.ISO_8601, true) : null;
  const now = moment.utc();
  if (!when || !when.isValid() || !when.isAfter(now) || when.isAfter(now.clone().add(MAX_SCHEDULE_DAYS, "days"))) {
    throw new AppError("newsletter_send_at_invalid", 400);
  }
  return when.toDate();
};

const loadForDelivery = async ({ actor, organizationId, newsletterId }) => {
  if (!isValidObjectId(newsletterId)) throw new AppError("newsletter_not_found", 404);

  const [newsletter] = await FamilyNewsletter.aggregate([
    { $match: { _id: toObjectId(newsletterId), organizationId: toObjectId(organizationId) } },
  ]);
  if (!newsletter) throw new AppError("newsletter_not_found", 404);

  await assertMayChangeSite({ actor, organizationId, branchId: newsletter.branchId });
  return newsletter;
};

/** What the newsletter will say with only the sections that are switched on. */
const hasContent = (newsletter) => {
  const on = newsletter.sections;
  return Boolean(
    (on.welcome && newsletter.welcome.text) ||
      (on.highlights && newsletter.highlights.length) ||
      (on.comingUp && newsletter.comingUp.length) ||
      (on.notices && newsletter.notices.length) ||
      (on.newResidents && newsletter.newResidents.length) ||
      (on.gallery && newsletter.gallery.length)
  );
};

/** The delivery chosen on the draft, with any change sent now laid over it. */
const chosenDelivery = (newsletter, change) => {
  const merged = { ...newsletter.delivery };
  if (change !== undefined) {
    Object.entries(checkDelivery(change)).forEach(([path, flag]) => {
      merged[path.slice("delivery.".length)] = flag;
    });
  }
  if (!CHANNELS.some((channel) => merged[channel])) throw new AppError("newsletter_delivery_required", 400);
  return Object.fromEntries(CHANNELS.map((channel) => [channel, Boolean(merged[channel])]));
};

const assertReadyToSend = (newsletter) => {
  if (!hasContent(newsletter)) throw new AppError("newsletter_empty", 400);
};

/**
 * One claim moves a draft or a scheduled newsletter to "sending", so a double click, two servers or
 * the scheduler racing a manager can never deliver it twice.
 */
const claim = (filter, set = {}) =>
  FamilyNewsletter.findOneAndUpdate(
    filter,
    { $set: { ...set, status: FamilyNewsletterStatus.SENDING } },
    { new: true, lean: true }
  );

/** Posts removed, or residents whose photo sharing was switched off since the draft, drop out at send time (BR-06). */
const pruneForSend = async (newsletter) => {
  const site = { organizationId: newsletter.organizationId, branchId: newsletter.branchId };
  const live = await FamilyPost.aggregate([...publishedPostsOfSite(site), { $project: { mediaIds: 1 } }]);
  const livePosts = new Set(live.map((post) => String(post._id)));
  const liveMedia = new Set(live.flatMap((post) => post.mediaIds.map(String)));

  const highlights = newsletter.highlights.filter((item) => livePosts.has(String(item.postId)));
  const gallery = newsletter.gallery.filter((item) => liveMedia.has(String(item.mediaId)));

  const consenting = newsletter.newResidents.length
    ? await Resident.aggregate([
        {
          $match: {
            _id: { $in: newsletter.newResidents.map((item) => item.residentId) },
            photographyConsent: true,
            admissionStatus: AdmissionStatus.ADMITTED,
          },
        },
        { $project: { _id: 1 } },
      ])
    : [];
  const consentingIds = new Set(consenting.map((resident) => String(resident._id)));
  const newResidents = newsletter.newResidents.filter((item) => consentingIds.has(String(item.residentId)));

  return { highlights, gallery, newResidents };
};

const recipientUsers = ({ organizationId, branchId }) =>
  FamilyMember.aggregate([
    {
      $match: {
        organizationId: toObjectId(organizationId),
        branchId: toObjectId(branchId),
        status: FamilyMemberStatus.ACTIVE,
      },
    },
    { $group: { _id: "$userId" } },
  ]);

const notifyInApp = async ({ newsletter, homeName }) => {
  const told = new Set((await NotificationExp.distinct("receiverId", { type: "familyNewsletter", objectId: newsletter._id })).map(String));
  const members = (await recipientUsers(newsletter)).filter((member) => !told.has(String(member._id)));
  const title = `${homeName || "Your home"}: ${newsletter.title}`;

  for (let i = 0; i < members.length; i += NOTIFY_CHUNK) {
    await NotificationExp.insertMany(
      members.slice(i, i + NOTIFY_CHUNK).map((member) => ({
        type: "familyNewsletter",
        subjectId: newsletter.sentBy || newsletter.authorId,
        objectId: newsletter._id,
        objectType: "familyNewsletter",
        receiverId: member._id,
        title,
        body: "A new newsletter from the home is ready to read.",
      })),
      { ordered: false }
    );
  }
  return members.length;
};

const PDF_CONTENT_TYPE = "application/pdf";

const slug = (text) =>
  String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const pdfFilename = (newsletter, homeName) =>
  `${slug(newsletter.footer?.homeName || homeName || "home")}-${newsletter.month}-newsletter.pdf`;

/** The photos the newsletter shows, read once from storage; one that cannot be read is simply left out. */
const loadPhotos = async (newsletter) => {
  const ids = [...new Set([...newsletter.highlights.map((item) => item.mediaId), ...newsletter.gallery.map((item) => item.mediaId)].filter(Boolean).map(String))];
  if (!ids.length) return new Map();

  const media = await FamilyMedia.aggregate([{ $match: { _id: { $in: ids.map(toObjectId) } } }, { $project: { storageKey: 1 } }]);
  const loaded = await Promise.all(
    media.map(async (item) => {
      try {
        return [String(item._id), await uploadAwsService.getObject(item.storageKey)];
      } catch (error) {
        console.error("family newsletter photo unreadable", error.message);
        return null;
      }
    })
  );
  return new Map(loaded.filter(Boolean));
};

/** Draws the newsletter as it is now. A draft is shown without what would be dropped at send time. */
const buildPdf = async (newsletter) => {
  const content = newsletter.status === FamilyNewsletterStatus.SENT ? newsletter : { ...newsletter, ...(await pruneForSend(newsletter)) };
  const [[branch], [organization], photos] = await Promise.all([
    Branch.aggregate([{ $match: { _id: newsletter.branchId } }, { $project: { name: 1, timezone: 1 } }]),
    Organization.aggregate([{ $match: { _id: newsletter.organizationId } }, { $project: { name: 1 } }]),
    loadPhotos(content),
  ]);

  const buffer = await renderNewsletterPdf({
    newsletter: content,
    organizationName: organization?.name || "",
    photos,
    timezone: branch?.timezone || "Europe/London",
  });
  return { buffer, filename: pdfFilename(content, branch?.name) };
};

/** The PDF channel: a sent copy is stored, so email attachments and downloads are the same file. */
const storePdf = async ({ newsletter, ctx }) => {
  const { buffer, filename } = await buildPdf({ ...newsletter, status: FamilyNewsletterStatus.SENT });
  ctx.pdf = { buffer, filename };
  const { key } = await uploadAwsService.putObject({
    key: `family/newsletters/${newsletter._id}.pdf`,
    body: buffer,
    contentType: PDF_CONTENT_TYPE,
  });
  await FamilyNewsletter.updateOne({ _id: newsletter._id, status: FamilyNewsletterStatus.SENDING }, { $set: { pdfKey: key } });
  return buffer.length;
};

/** Preview and download. Anything not sent is drawn fresh; a sent newsletter serves the copy stored at send time. */
const getPdf = async ({ organizationId, newsletterId }) => {
  if (!isValidObjectId(newsletterId)) throw new AppError("newsletter_not_found", 404);

  const [newsletter] = await FamilyNewsletter.aggregate([
    { $match: { _id: toObjectId(newsletterId), organizationId: toObjectId(organizationId) } },
  ]);
  if (!newsletter) throw new AppError("newsletter_not_found", 404);

  if (newsletter.status === FamilyNewsletterStatus.SENT && newsletter.pdfKey) {
    try {
      return { buffer: await uploadAwsService.getObject(newsletter.pdfKey), filename: pdfFilename(newsletter) };
    } catch (error) {
      console.error("family newsletter stored pdf unreadable", error.message);
    }
  }
  return buildPdf(newsletter);
};

/** The email carries the same PDF that is stored, drawn once whichever of the two channels asks first. */
const emailFamilies = async ({ newsletter, homeName, ctx }) => {
  if (!ctx.pdf) ctx.pdf = await buildPdf({ ...newsletter, status: FamilyNewsletterStatus.SENT });
  return sendNewsletterEmails({
    newsletter,
    homeName,
    periodLabel: moment.utc(`${newsletter.month}-01`).format("MMMM YYYY"),
    pdf: ctx.pdf.buffer,
    filename: ctx.pdf.filename,
    alreadySent: newsletter.emailedTo || [],
    onSent: (addresses) => FamilyNewsletter.updateOne({ _id: newsletter._id }, { $addToSet: { emailedTo: { $each: addresses } } }),
  });
};

/** One handler per channel. A handler returns a count, or its own { status, count, failed }. */
const CHANNEL_HANDLERS = { inApp: notifyInApp, pdf: storePdf, email: emailFamilies };

/** The PDF goes first, so the email can attach the stored copy instead of drawing it again. */
const DELIVERY_ORDER = ["pdf", "inApp", "email"];

/** Delivers on each chosen channel. A channel that fails is recorded and does not stop the others. */
const deliver = async (newsletter) => {
  const content = await pruneForSend(newsletter);
  const [branch] = await Branch.aggregate([{ $match: { _id: newsletter.branchId } }, { $project: { name: 1 } }]);
  const homeName = branch?.name || "";

  // Each channel is written down as soon as it finishes, so a send that is resumed after a crash skips what is done.
  const log = { ...(newsletter.deliveryLog || {}) };
  const ctx = {};
  for (const channel of DELIVERY_ORDER) {
    if (!newsletter.delivery[channel] || log[channel]) continue;
    const handler = CHANNEL_HANDLERS[channel];
    if (!handler) {
      log[channel] = { status: "skipped" };
    } else {
      try {
        const outcome = await handler({ newsletter: { ...newsletter, ...content }, homeName, ctx });
        log[channel] = typeof outcome === "object" ? outcome : { status: "done", count: outcome };
      } catch (error) {
        console.error(`family newsletter ${channel} delivery failed`, error.message);
        log[channel] = { status: "failed" };
      }
    }
    await FamilyNewsletter.updateOne({ _id: newsletter._id, status: FamilyNewsletterStatus.SENDING }, { $set: { [`deliveryLog.${channel}`]: log[channel] } });
  }

  const sentTo = await recipientsOf(newsletter);
  await FamilyNewsletter.updateOne(
    { _id: newsletter._id, status: FamilyNewsletterStatus.SENDING },
    { $set: { ...content, status: FamilyNewsletterStatus.SENT, sentAt: new Date(), sentTo, deliveryLog: log } }
  );
};

const SENDABLE = [FamilyNewsletterStatus.DRAFT, FamilyNewsletterStatus.SCHEDULED];

/** Draft or scheduled to sent, now. The channels are chosen here or were saved on the draft. */
const sendNow = async ({ actor, organizationId, newsletterId, delivery }) => {
  const newsletter = await loadForDelivery({ actor, organizationId, newsletterId });
  if (!SENDABLE.includes(newsletter.status)) throw new AppError("newsletter_already_sent", 409);
  assertReadyToSend(newsletter);
  const channels = chosenDelivery(newsletter, delivery);

  const claimed = await claim({ _id: newsletter._id, status: { $in: SENDABLE } }, { delivery: channels, sentBy: actor._id });
  if (!claimed) throw new AppError("newsletter_already_sent", 409);

  await deliver(claimed);
  return getNewsletter({ organizationId, newsletterId });
};

/** Draft to scheduled, or a new time for a scheduled one. It stays locked until the schedule is cancelled. */
const schedule = async ({ actor, organizationId, newsletterId, sendAt, delivery }) => {
  const newsletter = await loadForDelivery({ actor, organizationId, newsletterId });
  if (!SENDABLE.includes(newsletter.status)) throw new AppError("newsletter_already_sent", 409);
  assertReadyToSend(newsletter);
  const channels = chosenDelivery(newsletter, delivery);

  const updated = await FamilyNewsletter.updateOne(
    { _id: newsletter._id, status: { $in: SENDABLE } },
    { $set: { status: FamilyNewsletterStatus.SCHEDULED, sendAt: parseSendAt(sendAt), delivery: channels, sentBy: actor._id } }
  );
  if (!updated.matchedCount) throw new AppError("newsletter_already_sent", 409);
  return getNewsletter({ organizationId, newsletterId });
};

/** Scheduled back to a draft, so it can be edited again. */
const cancelSchedule = async ({ actor, organizationId, newsletterId }) => {
  const newsletter = await loadForDelivery({ actor, organizationId, newsletterId });
  const updated = await FamilyNewsletter.updateOne(
    { _id: newsletter._id, status: FamilyNewsletterStatus.SCHEDULED },
    { $set: { status: FamilyNewsletterStatus.DRAFT, sendAt: null } }
  );
  if (!updated.matchedCount) throw new AppError("newsletter_not_scheduled", 409);
  return getNewsletter({ organizationId, newsletterId });
};

/** Run every minute: scheduled newsletters that are due go out, each claimed once. */
const sendDueNewsletters = async ({ now = new Date(), limit = DUE_PER_RUN } = {}) => {
  let sent = 0;
  for (let i = 0; i < limit; i += 1) {
    const claimed = await FamilyNewsletter.findOneAndUpdate(
      { status: FamilyNewsletterStatus.SCHEDULED, sendAt: { $lte: now } },
      { $set: { status: FamilyNewsletterStatus.SENDING } },
      { sort: { sendAt: 1, _id: 1 }, new: true, lean: true }
    );
    if (!claimed) break;
    await deliver(claimed);
    sent += 1;
  }
  return { sent };
};

/**
 * A server that died mid-send leaves a newsletter in "sending". Once it has made no progress for a while it is
 * taken over and finished: channels that were completed are skipped, people already notified or emailed are not
 * contacted again. Taking it over is one claim, so two servers never finish the same one.
 */
const recoverStuckNewsletters = async ({ now = new Date(), limit = DUE_PER_RUN } = {}) => {
  let recovered = 0;
  const cutoff = new Date(now.getTime() - STUCK_AFTER_MS);
  for (let i = 0; i < limit; i += 1) {
    const claimed = await FamilyNewsletter.findOneAndUpdate(
      { status: FamilyNewsletterStatus.SENDING, updatedAt: { $lt: cutoff } },
      { $set: { updatedAt: now } },
      { sort: { updatedAt: 1, _id: 1 }, new: true, lean: true }
    );
    if (!claimed) break;
    await deliver(claimed);
    recovered += 1;
  }
  return { recovered };
};

module.exports = {
  createDraft,
  updateDraft,
  deleteDraft,
  listNewsletters,
  getNewsletter,
  sendNow,
  schedule,
  cancelSchedule,
  sendDueNewsletters,
  recoverStuckNewsletters,
  getPdf,
  pruneForSend,
};
