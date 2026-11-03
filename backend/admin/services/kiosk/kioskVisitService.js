const { ExternalPerson } = require("@models/ExternalPerson");
const { VisitSession } = require("@models/VisitSession");
const { Document } = require("@models/Document");
const { DocumentSignature } = require("@models/DocumentSignature");
const { Invitation } = require("@models/Invitation");
const { paginateWithFacet } = require("@utils/paginate");
const { generateMeta } = require("@utils/responseUtil");
const { AppError } = require("@services/_errors/AppError");
const {
  VisitMethod,
  VisitSessionStatus,
  ExternalPersonType,
  DocumentAudience,
  InvitationStatus,
  BadgeType,
  KioskMode,
} = require("@models/domainEnums");
const visitSessionService = require("@adminServices/visitors/visitSessionService");
const {
  createExternalPersonAtBranch,
  parsePersonType,
} = require("@adminServices/visitors/externalPersonService");
const visitorInvitationService = require("@adminServices/visitors/visitorInvitationService");
const { toPublicImageUrl } = require("@utils/imageHelper");
const { Branch } = require("@models/Branch");
const { Kiosk } = require("@models/Kiosk");
const moment = require("moment-timezone");
const { versionFile } = require("@adminServices/documents/documentService");
const {
  policyCategoryIds,
} = require("@adminServices/documents/documentCategoryService");
const {
  listVisitCategories,
} = require("@adminServices/visitors/personCategoryService");

const MIN_SEARCH_LENGTH = 2;

const escapeRegex = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const applyPersonPhoto = async (person, image) => {
  if (!person?._id) return person;
  const photoUrl = toPublicImageUrl(image);
  if (photoUrl) {
    await ExternalPerson.updateOne({ _id: person._id }, { $set: { photoUrl } });
    return { ...person, photoUrl };
  }
  return { ...person, photoUrl: toPublicImageUrl(person.photoUrl) };
};

const CLOCK_IN_TZ = "Europe/London";

const greetingForHour = (hour) => {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
};

const shapeVisit = async ({ session, person, kiosk, invitation }) => {
  const url = toPublicImageUrl(person?.photoUrl);
  const branch = session?.branchId
    ? await Branch.findById(session.branchId).select("timezone name").lean()
    : null;
  const tz = branch?.timezone || CLOCK_IN_TZ;
  const clockMoment = moment.tz(session?.arrivedAt || new Date(), tz);
  const shiftLabel =
    invitation?.arrivalAt && invitation?.visitingUntil
      ? `${moment.tz(invitation.arrivalAt, tz).format("HH:mm")} – ${moment
          .tz(invitation.visitingUntil, tz)
          .format("HH:mm")}`
      : null;
  const location = kiosk?.locationLabel || branch?.name || "";
  const name = person?.name || "";
  const time = clockMoment.format("hh:mm a");

  return {
    session,
    person: person
      ? {
          _id: person._id,
          name: person.name,
          type: person.type,
          photoUrl: url,
          image: url,
        }
      : null,
    image: url,
    photoUrl: url,
    greeting: greetingForHour(clockMoment.hour()),
    name,
    time,
    location,
    shift: shiftLabel,
    summary: {
      name,
      time,
      shift: shiftLabel,
      location,
    },
    locationLabel: location,
    receptionIdentifier: kiosk?.receptionIdentifier || "",
    arrivalWindow: invitation
      ? { from: invitation.arrivalAt, until: invitation.visitingUntil }
      : null,
  };
};

const searchVisitPeople = async ({
  branchId,
  keyword,
  page,
  limit,
  skip,
}) => {
  const term = String(keyword ?? "").trim();
  if (term.length < MIN_SEARCH_LENGTH) {
    throw new AppError("kiosk_branch_search_term_too_short", 400);
  }

  return paginateWithFacet({
    model: ExternalPerson,
    match: {
      branchId,
      name: { $regex: escapeRegex(term), $options: "i" },
    },
    page,
    limit,
    skip,
    sort: { name: 1 },
    extraDataStages: [
      {
        $project: {
          name: 1,
          type: 1,
          photoUrl: 1,
          email: 1,
          phone: 1,
          categoryId: 1,
        },
      },
    ],
  });
};

const listVisitPolicies = async ({ organizationId, branchId, personType }) => {
  const audience =
    personType === ExternalPersonType.CONTRACTOR
      ? DocumentAudience.CONTRACTOR
      : DocumentAudience.VISITOR;

  const categoryIds = await policyCategoryIds(organizationId);

  const docs = await Document.aggregate([
    {
      $match: {
        organizationId,
        requiresSignature: true,
        $or: [{ branchId }, { branchId: null }],
        $and: [
          {
            $or: [
              { audiences: audience },
              {
                $and: [
                  {
                    $or: [
                      { audiences: { $exists: false } },
                      { audiences: { $size: 0 } },
                    ],
                  },
                  { categoryId: { $in: categoryIds } },
                ],
              },
            ],
          },
        ],
      },
    },
    { $sort: { title: 1 } },
    {
      $lookup: {
        from: "documentversions",
        localField: "currentVersionId",
        foreignField: "_id",
        as: "version",
      },
    },
    {
      $lookup: {
        from: "documentcategories",
        localField: "categoryId",
        foreignField: "_id",
        as: "category",
      },
    },
  ]);

  return docs.map((row) => {
    const file = versionFile(row.version?.[0] || null);
    const category = row.category?.[0] || null;
    return {
      _id: row._id,
      title: row.title,
      categoryId: row.categoryId || null,
      category: category?.legacyKey || category?.title || "",
      categoryTitle: category?.title || "",
      currentVersionId: row.currentVersionId,
      file,
      body: file?.url || "",
    };
  });
};

const applySignatures = async ({
  branchId,
  person,
  signatures,
  policies,
}) => {
  if (!policies.length) return [];

  const byDoc = new Map(
    (signatures || []).map((row) => [String(row.documentId), row])
  );
  const missing = policies.filter((doc) => !byDoc.get(String(doc._id)));
  if (missing.length) throw new AppError("visit_policies_not_signed", 400);

  const now = new Date();
  await DocumentSignature.insertMany(
    policies.map((policy) => {
      const row = byDoc.get(String(policy._id));
      if (!policy.currentVersionId) {
        throw new AppError("visit_policy_version_missing", 400);
      }
      return {
        documentId: policy._id,
        documentVersionId: policy.currentVersionId,
        branchId,
        signerExternalPersonId: person._id,
        signerName: person.name,
        signatureUrl: row.signatureUrl || "",
        signedAt: now,
      };
    })
  );

  return policies.map((policy) => ({
    type: policy.category || policy.title,
    signedAt: now,
    signatureUrl: byDoc.get(String(policy._id))?.signatureUrl || "",
  }));
};

const verifyInvite = async ({ branchId, inviteCode }) => {
  const invitation = await visitorInvitationService.getOpenInvitationByCode({
    branchId,
    inviteCode,
  });
  return {
    invitationId: invitation._id,
    visitorName: invitation.visitorName,
    visitorEmail: invitation.visitorEmail,
    hostStaffId: invitation.hostStaffId,
    arrivalAt: invitation.arrivalAt,
    visitingUntil: invitation.visitingUntil,
  };
};

const resendInvite = async ({ branchId, organizationId, email }) =>
  visitorInvitationService.resendVisitorInvitationByEmail({
    organizationId,
    branchId,
    email,
  });

const checkInByInvitation = async ({
  organizationId,
  branchId,
  kiosk,
  inviteCode,
  photoUrl,
}) => {
  const invitation = await visitorInvitationService.getOpenInvitationByCode({
    branchId,
    inviteCode,
  });

  let person = await ExternalPerson.findOne({
    branchId,
    email: invitation.visitorEmail,
  }).lean();

  if (!person) {
    person = await createExternalPersonAtBranch({
      branchId,
      type:
        invitation.badgeType === BadgeType.CONTRACTOR
          ? ExternalPersonType.CONTRACTOR
          : ExternalPersonType.VISITOR,
      name: invitation.visitorName,
      email: invitation.visitorEmail,
      photoUrl: toPublicImageUrl(photoUrl),
    });
  }

  person = await applyPersonPhoto(person, photoUrl);

  const session = await visitSessionService.createVisitSession({
    organizationId,
    branchId,
    externalPersonId: person._id,
    personType: person.type,
    method: VisitMethod.INVITATION,
    hostStaffId: invitation.hostStaffId,
    hostName: "",
    kioskId: kiosk._id,
    invitationId: invitation._id,
    status: VisitSessionStatus.ON_SITE,
  });

  await visitorInvitationService.markInvitationCheckedIn({
    invitation,
    visitSessionId: session._id,
  });

  return shapeVisit({ session, person, kiosk, invitation });
};

const confirmContractorQrCheckIn = async ({
  organizationId,
  branchId,
  kioskId,
  externalPersonId,
  invitationId,
  photoUrl,
}) => {
  let person = await ExternalPerson.findOne({
    _id: externalPersonId,
    branchId,
    type: ExternalPersonType.CONTRACTOR,
  }).lean();
  if (!person) throw new AppError("contractor_not_at_kiosk_branch", 403);
  person = await applyPersonPhoto(person, photoUrl);

  const invitation = await Invitation.findOne({
    _id: invitationId,
    branchId,
    badgeType: BadgeType.CONTRACTOR,
    status: { $in: visitorInvitationService.OPEN_INVITE_STATUSES },
  });
  if (!invitation) throw new AppError("contractor_invitation_required", 403);
  if (invitation.visitingUntil && invitation.visitingUntil.getTime() < Date.now()) {
    invitation.status = InvitationStatus.EXPIRED;
    await invitation.save();
    throw new AppError("invitation_expired", 400);
  }

  const session = await visitSessionService.createVisitSession({
    organizationId,
    branchId,
    externalPersonId: person._id,
    personType: person.type,
    method: VisitMethod.INVITATION,
    hostStaffId: invitation.hostStaffId,
    hostName: "",
    kioskId,
    invitationId: invitation._id,
    status: VisitSessionStatus.ON_SITE,
  });

  await visitorInvitationService.markInvitationCheckedIn({
    invitation,
    visitSessionId: session._id,
  });

  const kiosk = await Kiosk.findById(kioskId).select("locationLabel").lean();
  return shapeVisit({ session, person, kiosk, invitation });
};

const checkInWalkIn = async ({
  organizationId,
  branchId,
  kiosk,
  externalPersonId,
  type,
  name,
  email,
  phone,
  carRegistration,
  photoUrl,
  hostStaffId,
  hostName,
  purposeOfVisit,
  categoryId,
  signatures,
}) => {
  let person;
  let firstVisit = false;

  if (externalPersonId) {
    person = await ExternalPerson.findOne({
      _id: externalPersonId,
      branchId,
    }).lean();
    if (!person) throw new AppError("external_person_not_found", 404);
  } else {
    firstVisit = true;
    person = await createExternalPersonAtBranch({
      branchId,
      type: parsePersonType(type || ExternalPersonType.VISITOR),
      name,
      email,
      phone,
      photoUrl: toPublicImageUrl(photoUrl),
      carRegistration,
      categoryId,
    });
  }

  person = await applyPersonPhoto(person, photoUrl);

  const isContractor = person.type === ExternalPersonType.CONTRACTOR;
  const policies = firstVisit || isContractor
    ? await listVisitPolicies({
        organizationId,
        branchId,
        personType: person.type,
      })
    : [];

  const policiesSigned = await applySignatures({
    branchId,
    person,
    signatures,
    policies,
  });

  const session = await visitSessionService.createVisitSession({
    organizationId,
    branchId,
    externalPersonId: person._id,
    personType: person.type,
    method: VisitMethod.WALK_IN,
    purposeOfVisit,
    hostStaffId,
    hostName,
    kioskId: kiosk._id,
    status: firstVisit
      ? VisitSessionStatus.AWAITING_APPROVAL
      : VisitSessionStatus.ON_SITE,
    policiesSigned,
  });

  return shapeVisit({ session, person, kiosk });
};

const checkInAtKiosk = async ({
  organizationId,
  branchId,
  kiosk,
  method,
  inviteCode,
  ...walkIn
}) => {
  if (kiosk?.kioskMode === KioskMode.LOCKED) {
    throw new AppError("kiosk_locked", 403);
  }
  if (method === VisitMethod.INVITATION || inviteCode) {
    return checkInByInvitation({
      organizationId,
      branchId,
      kiosk,
      inviteCode,
      photoUrl: walkIn.photoUrl,
    });
  }

  if (method && method !== VisitMethod.WALK_IN) {
    throw new AppError("invalid_visit_method", 400);
  }

  return checkInWalkIn({
    organizationId,
    branchId,
    kiosk,
    ...walkIn,
  });
};

const checkOutAtKiosk = async ({
  branchId,
  kiosk,
  visitSessionId,
  externalPersonId,
  inviteCode,
}) => {
  if (kiosk?.kioskMode === KioskMode.LOCKED) {
    throw new AppError("kiosk_locked", 403);
  }
  let session;
  if (visitSessionId) {
    session = await VisitSession.findOne({ _id: visitSessionId, branchId });
  } else if (externalPersonId) {
    session = await VisitSession.findOne({
      branchId,
      externalPersonId,
      status: VisitSessionStatus.ON_SITE,
      checkOutAt: null,
    }).sort({ checkInAt: -1 });
  } else if (inviteCode) {
    const invitation = await Invitation.findOne({
      branchId,
      inviteCode: visitorInvitationService.normalizeCode(inviteCode),
      status: InvitationStatus.CHECKED_IN,
    }).lean();
    if (invitation?.visitSessionId) {
      session = await VisitSession.findOne({
        _id: invitation.visitSessionId,
        branchId,
      });
    }
  }

  if (!session) throw new AppError("visit_session_not_found", 404);
  if (session.status !== VisitSessionStatus.ON_SITE || session.checkOutAt) {
    throw new AppError("visit_not_on_site", 409);
  }

  session.status = VisitSessionStatus.CHECKED_OUT;
  session.checkOutAt = new Date();
  await session.save();
  return session.toObject();
};

const listOnSiteVisits = async ({ branchId, keyword, page, limit, skip }) => {
  const match = {
    branchId,
    status: VisitSessionStatus.ON_SITE,
    checkOutAt: null,
  };

  const term = String(keyword || "").trim();
  if (term) {
    const regex = { $regex: escapeRegex(term), $options: "i" };
    const personIds = await ExternalPerson.find({
      branchId,
      $or: [{ name: regex }, { email: regex }],
    }).distinct("_id");
    if (!personIds.length) {
      return { data: [], meta: generateMeta(page, limit, 0) };
    }
    match.externalPersonId = { $in: personIds };
  }

  return paginateWithFacet({
    model: VisitSession,
    match,
    page,
    limit,
    skip,
    sort: { checkInAt: -1 },
    extraDataStages: [
      {
        $lookup: {
          from: ExternalPerson.collection.name,
          localField: "externalPersonId",
          foreignField: "_id",
          as: "person",
        },
      },
      { $unwind: { path: "$person", preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          sessionId: "$_id",
          person: {
            _id: "$person._id",
            name: { $ifNull: ["$person.name", ""] },
            email: { $ifNull: ["$person.email", ""] },
            type: "$person.type",
          },
        },
      },
    ],
  });
};

module.exports = {
  listVisitCategories,
  searchVisitPeople,
  listVisitPolicies,
  verifyInvite,
  resendInvite,
  checkInAtKiosk,
  confirmContractorQrCheckIn,
  checkOutAtKiosk,
  listOnSiteVisits,
};
