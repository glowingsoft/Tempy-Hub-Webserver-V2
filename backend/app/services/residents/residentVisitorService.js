const moment = require("moment-timezone");
const { VisitSession } = require("@models/VisitSession");
const { Invitation } = require("@models/Invitation");
const { ExternalPerson } = require("@models/ExternalPerson");
const { PersonCategory } = require("@models/PersonCategory");
const { FamilyMember } = require("@models/FamilyMember");
const { User } = require("@models/UserModel");
const { Branch } = require("@models/Branch");
const {
  FamilyMemberStatus,
  VisitSessionStatus,
} = require("@models/domainEnums");
const { facetCount } = require("@utils/paginate");
const { toPublicImageUrl } = require("@utils/imageHelper");
const { generateMeta } = require("@utils/responseUtil");
const { toObjectId, joinOne } = require("@appServices/family/familyPipeline");
const {
  listRelationships,
} = require("@appServices/family/familyAccessService");

const DEFAULT_TIMEZONE = "Europe/London";

const titleCase = (value) =>
  String(value || "")
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (letter) => letter.toUpperCase());

const lower = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

const listFamily = (residentId) =>
  FamilyMember.aggregate([
    {
      $match: {
        residentId: toObjectId(residentId),
        status: FamilyMemberStatus.ACTIVE,
      },
    },
    ...joinOne({ from: User, localField: "userId", as: "user" }),
    {
      $project: {
        userId: 1,
        relationship: 1,
        email: "$user.email",
        photoUrl: "$user.profileIcon",
      },
    },
  ]);

const visitsByFamily = async ({ residentId, branchId, family }) => {
  if (!family.length) return null;
  const people = await ExternalPerson.find({
    branchId,
    $or: [
      { userId: { $in: family.map((member) => member.userId) } },
      { email: { $in: family.map((member) => lower(member.email)) } },
    ],
  })
    .select("_id")
    .lean();
  if (!people.length) return null;

  const personIds = people.map((person) => person._id);
  const usedInvitationIds = await VisitSession.distinct("invitationId", {
    externalPersonId: { $in: personIds },
    invitationId: { $ne: null },
  });
  const otherInvitationIds = await Invitation.distinct("_id", {
    _id: { $in: usedInvitationIds },
    residentId: { $nin: [null, toObjectId(residentId)] },
  });
  return {
    externalPersonId: { $in: personIds },
    residentId: { $in: [null, toObjectId(residentId)] },
    invitationId: { $nin: otherInvitationIds },
  };
};

const visitsOfResident = async ({ residentId, branchId, family }) => {
  const [invitationIds, byFamily] = await Promise.all([
    Invitation.distinct("_id", { residentId: toObjectId(residentId) }),
    visitsByFamily({ residentId, branchId, family }),
  ]);
  return {
    $or: [
      { residentId: toObjectId(residentId) },
      { invitationId: { $in: invitationIds } },
      ...(byFamily ? [byFamily] : []),
    ],
    externalPersonId: { $ne: null },
  };
};

const onePerPerson = [
  { $addFields: { signedInAt: { $ifNull: ["$checkInAt", "$arrivedAt"] } } },
  { $sort: { signedInAt: -1, _id: -1 } },
  { $group: { _id: "$externalPersonId", visit: { $first: "$$ROOT" } } },
  { $replaceRoot: { newRoot: "$visit" } },
];

const listHereNow = (visits) =>
  VisitSession.aggregate([
    {
      $match: {
        ...visits,
        status: VisitSessionStatus.ON_SITE,
        checkOutAt: null,
      },
    },
    ...onePerPerson,
    { $sort: { signedInAt: 1, _id: 1 } },
  ]);

const listRecent = async ({ visits, excludedPersonIds, skip, limit }) => {
  const [result] = await VisitSession.aggregate([
    {
      $match: {
        $and: [visits, { externalPersonId: { $nin: excludedPersonIds } }],
        status: VisitSessionStatus.CHECKED_OUT,
      },
    },
    ...onePerPerson,
    {
      $facet: {
        data: [
          { $sort: { signedInAt: -1, _id: -1 } },
          { $skip: skip },
          { $limit: limit },
        ],
        total: [{ $count: "count" }],
      },
    },
  ]);
  return { rows: result.data, total: facetCount(result.total) };
};

const describePeople = async ({ family, personIds }) => {
  if (!personIds.length) return new Map();

  const people = await ExternalPerson.aggregate([
    { $match: { _id: { $in: personIds } } },
    ...joinOne({
      from: PersonCategory,
      localField: "categoryId",
      as: "category",
      optional: true,
    }),
    {
      $project: {
        name: 1,
        email: 1,
        userId: 1,
        photoUrl: 1,
        visitorCategory: 1,
        categoryName: "$category.name",
      },
    },
  ]);

  const labels = new Map(
    listRelationships().map((option) => [option.value, option.label]),
  );

  return new Map(
    people.map((person) => {
      const member = family.find(
        (row) =>
          String(row.userId) === String(person.userId) ||
          (person.email && lower(row.email) === lower(person.email)),
      );
      return [
        String(person._id),
        {
          name: person.name || "",
          photoUrl: person.photoUrl || member?.photoUrl || "",
          relationshipLabel: member
            ? labels.get(member.relationship) || ""
            : "",
          categoryLabel: person.categoryName || person.visitorCategory || "",
        },
      ];
    }),
  );
};

const toVisitor = ({ row, people }) => {
  const person = people.get(String(row.externalPersonId));
  return {
    _id: row._id,
    personKind: row.personType,
    personId: row.externalPersonId,
    branchId: row.branchId,
    name: person?.name || "",
    photoUrl: toPublicImageUrl(person?.photoUrl) || "",
    category: person?.categoryLabel || "",
    method: row.method || "",
    visitPurpose: row.purposeOfVisit || "",
    hostName: row.hostName || "",
    signedInAt: row.signedInAt ?? null,
    role:
      person?.relationshipLabel ||
      person?.categoryLabel ||
      titleCase(row.personType),
    isFamily: Boolean(person?.relationshipLabel),
  };
};

const subtitleOf = (...parts) => parts.filter(Boolean).join(" · ");

const getVisitorsScreen = async ({ resident, page, limit, skip }) => {
  const family = await listFamily(resident.residentId);
  const visits = await visitsOfResident({
    residentId: resident.residentId,
    branchId: resident.branchId,
    family,
  });
  const here = await listHereNow(visits);
  const [recent, branch] = await Promise.all([
    listRecent({
      visits,
      excludedPersonIds: here.map((row) => row.externalPersonId),
      skip,
      limit,
    }),
    Branch.findById(resident.branchId).select("timezone").lean(),
  ]);
  const timezone = branch?.timezone || DEFAULT_TIMEZONE;
  const people = await describePeople({
    family,
    personIds: [...here, ...recent.rows].map((row) => row.externalPersonId),
  });
  const format = (value, pattern) =>
    value ? moment.tz(value, timezone).format(pattern) : "";

  const hereNow = here.map((row) => {
    const visitor = toVisitor({ row, people });
    const time = format(row.signedInAt, "HH:mm");
    return {
      ...visitor,
      subtitle: subtitleOf(visitor.role, time ? `arrived ${time}` : ""),
    };
  });
  const recentVisitors = recent.rows.map((row) => {
    const visitor = toVisitor({ row, people });
    return {
      ...visitor,
      signedOutAt: row.checkOutAt ?? null,
      subtitle: subtitleOf(visitor.role, format(row.signedInAt, "ddd D MMM")),
    };
  });

  return {
    data: {
      resident: {
        name: resident.name,
        photoUrl: resident.photoUrl,
        homeName: resident.branchName,
      },
      hereNow: { count: hereNow.length, visitors: hereNow },
      recentVisitors,
    },
    meta: generateMeta(page, limit, recent.total),
  };
};

module.exports = { getVisitorsScreen };
