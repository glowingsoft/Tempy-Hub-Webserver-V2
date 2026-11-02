const { FamilyVisit } = require("@models/FamilyVisit");
const { FamilyVisitPass } = require("@models/FamilyVisitPass");
const { Invitation } = require("@models/Invitation");
const {
  FamilyVisitStatus,
  FamilyVisitSource,
  FamilyVisitReply,
} = require("@models/domainEnums");
const { AppError } = require("@services/_errors/AppError");
const { toObjectId } = require("./familyPipeline");
const { loadRules, visitingNotice, isText } = require("./familyVisitRules");
const { OPEN_INVITATION_STATUSES } = require("./familyVisitInvitation");

const MAX_GUESTS = 10;
const MAX_GUEST_NAME = 60;
const MAX_REGISTRATION = 12;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const REGISTRATION = /^[A-Z0-9][A-Z0-9 -]*$/;

const cleanGuests = (value) => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_GUESTS)
    throw new AppError("invalid_guests", 400, { max: MAX_GUESTS });

  return value.map((entry) => {
    const name = isText(entry) ? entry.trim().replace(/\s+/g, " ") : "";
    if (!name || name.length > MAX_GUEST_NAME || CONTROL_CHARACTERS.test(name))
      throw new AppError("invalid_guests", 400, { max: MAX_GUESTS });
    return name;
  });
};

const cleanRegistration = (value) => {
  if (value === undefined) return undefined;
  if (value === null || value === "") return "";
  const text = isText(value)
    ? value.trim().replace(/\s+/g, " ").toUpperCase()
    : "";
  if (!text || text.length > MAX_REGISTRATION || !REGISTRATION.test(text))
    throw new AppError("invalid_car_registration", 400);
  return text;
};

/**
 * Visit Pass: the code the kiosk reads for my next visit, with the guests and car registration I keep.
 * The code is the visit's own invitation code, so the kiosk accepts it exactly as it accepts an emailed one.
 * Only a visit I requested, or a home invitation I said I would attend, gives me a code.
 */
const getPass = async ({ link, userId, now = new Date() }) => {
  const me = toObjectId(userId);
  const [rules, [row], saved] = await Promise.all([
    loadRules(link.branchId),
    FamilyVisit.aggregate([
      {
        $match: {
          organizationId: toObjectId(link.organizationId),
          residentId: toObjectId(link.residentId),
          endAt: { $gte: now },
          $or: [
            {
              source: FamilyVisitSource.FAMILY,
              requestedBy: me,
              status: FamilyVisitStatus.CONFIRMED,
            },
            {
              source: FamilyVisitSource.HOME,
              status: FamilyVisitStatus.INVITED,
              replies: {
                $elemMatch: { userId: me, response: FamilyVisitReply.GOING },
              },
            },
          ],
        },
      },
      {
        $addFields: {
          myInvitationId: {
            $cond: [
              { $eq: ["$source", FamilyVisitSource.FAMILY] },
              "$invitationId",
              {
                $let: {
                  vars: {
                    reply: {
                      $arrayElemAt: [
                        {
                          $filter: {
                            input: "$replies",
                            as: "entry",
                            cond: { $eq: ["$$entry.userId", me] },
                          },
                        },
                        0,
                      ],
                    },
                  },
                  in: "$$reply.invitationId",
                },
              },
            ],
          },
        },
      },
      {
        $lookup: {
          from: Invitation.collection.name,
          localField: "myInvitationId",
          foreignField: "_id",
          as: "invitation",
        },
      },
      { $unwind: "$invitation" },
      { $match: { "invitation.status": { $in: OPEN_INVITATION_STATUSES } } },
      { $sort: { startAt: 1, _id: 1 } },
      { $limit: 1 },
      {
        $project: {
          _id: 0,
          id: "$_id",
          startAt: 1,
          endAt: 1,
          partySize: 1,
          code: "$invitation.inviteCode",
        },
      },
    ]),
    FamilyVisitPass.findOne({
      userId: me,
      residentId: toObjectId(link.residentId),
    })
      .select("guests carRegistration")
      .lean(),
  ]);

  const { code = null, ...visit } = row || {};
  return {
    visit: row ? visit : null,
    code,
    guests: saved?.guests || [],
    carRegistration: saved?.carRegistration || "",
    visiting: visitingNotice(rules),
  };
};

/** Saves the guests without the app and the car registration; whatever is left out stays as it was. */
const updatePass = async ({ link, userId, body = {}, now = new Date() }) => {
  const set = {};
  const guests = cleanGuests(body.guests);
  const carRegistration = cleanRegistration(body.carRegistration);
  if (guests !== undefined) set.guests = guests;
  if (carRegistration !== undefined) set.carRegistration = carRegistration;
  if (!Object.keys(set).length) throw new AppError("nothing_to_update", 400);

  await FamilyVisitPass.updateOne(
    { userId: toObjectId(userId), residentId: toObjectId(link.residentId) },
    { $set: set },
    { upsert: true },
  );
  return getPass({ link, userId, now });
};

module.exports = { getPass, updatePass };
