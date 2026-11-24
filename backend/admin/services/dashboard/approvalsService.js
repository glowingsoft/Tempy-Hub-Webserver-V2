const { AppError } = require("@services/_errors/AppError");
const mongoose = require("mongoose");
const { FamilyMember } = require("@models/FamilyMember");
const { FamilyCode } = require("@models/FamilyCode");
const { Resident } = require("@models/Resident");
const { Kiosk } = require("@models/Kiosk");
const { StaffProfile } = require("@models/StaffProfile");
const { ExternalPerson } = require("@models/ExternalPerson");
const { Shift } = require("@models/Shift");
const { Branch } = require("@models/Branch");
const { JobTitle } = require("@models/JobTitle");
const { getFullImageUrl } = require("@utils/imageHelper");
const moment = require("moment-timezone");
const { User } = require("@models/UserModel");
const {
  ModuleSlug,
  FamilyMemberStatus,
  FamilyJoinSource,
  VisitSessionStatus,
  VisitMethod,
  ShiftStatus,
  ShiftClaimStatus,
} = require("@models/domainEnums");
const { requireManageableResident } = require("@adminServices/family/familyService");
const {
  isFamilyModuleActive,
} = require("@appServices/family/familyAccessService");
const familyVisitService = require("@adminServices/family/familyVisitStaffService");
const familyModerationService = require("@adminServices/family/familyModerationService");
const familyStaffService = require("@adminServices/family/familyStaffService");
const visitSessionService = require("@adminServices/visitors/visitSessionService");
const shiftService = require("@adminServices/rota/shiftService");
const leaveService = require("@adminServices/leave/leaveService");

const TAB_NAMES = ["visitors", "shifts", "leave", "photos", "joins"];
const LEAVE_LABELS = {
  annual: "Holiday",
  sick: "Sickness",
  absence: "Absence",
  unpaid: "Unpaid Leave",
  compassionate: "Compassionate Leave",
  parental: "Parental Leave",
  other: "Leave",
};

const moduleIsActive = (organization, moduleSlug, isPlatformAdmin) =>
  isPlatformAdmin ||
  (organization?.moduleAccess || []).some(
    (module) =>
      module.moduleSlug === moduleSlug &&
      module.enabled &&
      (!module.expiresAt || new Date(module.expiresAt) > new Date()),
  );

const availableTabs = ({ organization, isPlatformAdmin }) => {
  const family = isFamilyModuleActive(organization) || isPlatformAdmin;
  return {
    visitors: family,
    shifts: moduleIsActive(
      organization,
      ModuleSlug.ROTA_SCHEDULING,
      isPlatformAdmin,
    ),
    leave: moduleIsActive(organization, ModuleSlug.LEAVE, isPlatformAdmin),
    photos: family,
    joins: family,
  };
};

const getSiteApprovalDetail = async ({
  actor,
  organizationId,
  organization,
  isPlatformAdmin,
  type,
  itemId,
}) => {
  const detailType = String(type || "").trim();
  const id = String(itemId || "").trim();
  if (!id) throw new AppError("approval_item_id_required", 400);

  const familyTypes = ["familyPhoto", "familyLink"];
  const familyEnabled = isFamilyModuleActive(organization) || isPlatformAdmin;
  const visitorEntryEnabled = moduleIsActive(
    organization,
    ModuleSlug.FIRE_DRILL_EVACUATION,
    isPlatformAdmin,
  );
  const enabledModuleForType = {
    shiftClaim: moduleIsActive(organization, ModuleSlug.ROTA_SCHEDULING, isPlatformAdmin),
    leaveRequest: moduleIsActive(organization, ModuleSlug.LEAVE, isPlatformAdmin),
  };
  if (familyTypes.includes(detailType) && !familyEnabled) {
    throw new AppError("family_module_not_enabled", 403);
  }
  if (enabledModuleForType[detailType] === false) {
    throw new AppError("module_not_enabled", 403);
  }

  let data;
  let availableRejectReasons;
  switch (detailType) {
    case "visitorEntry": {
      const familyVisit = familyEnabled
        ? await familyVisitService.findVisit({
            actor,
            organizationId,
            visitId: id,
          })
        : null;
      if (familyVisit) {
        const resident = familyVisit.residentId
          ? await Resident.findById(familyVisit.residentId)
              .select("roomNumber")
              .lean()
          : null;
        const visitor = familyVisit.requestedBy || null;
        data = {
          ...familyVisit,
          residentId: familyVisit.residentId || null,
          location: resident?.roomNumber ? `Room ${resident.roomNumber}` : "",
          visitor: visitor
            ? {
                ...visitor,
                profileIcon: getFullImageUrl(visitor.photoUrl),
              }
            : null,
        };
        break;
      }
      if (!visitorEntryEnabled) throw new AppError("module_not_enabled", 403);
      const session = await visitSessionService.getVisitSession({
        actor,
        organizationId,
        visitSessionId: id,
      });
      data = { ...session, ...(await visitorEntryScreen(session)) };
      break;
    }
    case "shiftClaim": {
      const claim = await shiftService.getClaim({ actor, organizationId, claimId: id });
      data = { ...claim, ...(await shiftClaimScreen(claim)) };
      break;
    }
    case "leaveRequest":
      data = await leaveService.getLeaveRequest({
        actor,
        organizationId,
        requestId: id,
      });
      break;
    case "familyPhoto":
      data = await familyModerationService.getUpload({
        actor,
        organizationId,
        uploadId: id,
      });
      availableRejectReasons = Object.entries(
        familyModerationService.REJECT_REASONS,
      ).map(([key, label]) => ({ key, label }));
      break;
    case "familyLink":
      data =
        (await joinRequestDetail({ actor, organizationId, requestId: id })) ||
        (await familyStaffService.getFamily({
          actor,
          organizationId,
          residentId: id,
        }));
      break;
    default:
      throw new AppError("invalid_approval_detail_type", 400, {
        validTypes: "visitorEntry,shiftClaim,leaveRequest,familyPhoto,familyLink",
      });
  }

  return {
    type: detailType,
    data,
    ...(availableRejectReasons
      ? { availableRejectReasons, rejectNoteOptional: true }
      : {}),
  };
};

const timestampOf = (row) =>
  row.createdAt || row.requestedAt || row.startAt || row.startDate || null;

const shortDate = (value, { weekday = false } = {}) => {
  if (!value || Number.isNaN(new Date(value).getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    ...(weekday ? { weekday: "short" } : {}),
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(value)).replace("Sept", "Sep");
};

const shortTime = (value) => {
  if (!value || Number.isNaN(new Date(value).getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC",
  }).format(new Date(value));
};

const dayDistanceFromNow = (value, now = new Date()) => {
  if (!value || Number.isNaN(new Date(value).getTime())) return null;
  const date = new Date(value);
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const targetUtc = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.round((targetUtc - todayUtc) / 86_400_000);
};

const daysSince = (value, now) => {
  const distance = dayDistanceFromNow(value, now);
  return distance == null ? null : -distance;
};

const titleCase = (value) =>
  String(value || "")
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (letter) => letter.toUpperCase());

const dayCount = (count) => `${count} ${count === 1 ? "Day" : "Days"}`;

const ESCALATE_AFTER_DAYS = 7;

const joinRequestDetail = async ({ actor, organizationId, requestId, now = new Date() }) => {
  if (!mongoose.isValidObjectId(requestId)) return null;
  const request = await FamilyMember.findOne({
    _id: requestId,
    organizationId,
    status: FamilyMemberStatus.PENDING,
  }).lean();
  if (!request) return null;

  const resident = await requireManageableResident({
    actor,
    organizationId,
    residentId: request.residentId,
  });

  const [person, residentInfo, nextOfKin, code] = await Promise.all([
    User.findById(request.userId).select("name email profileIcon").lean(),
    Resident.findById(resident._id).select("roomNumber photoUrl").lean(),
    FamilyMember.findOne({
      residentId: resident._id,
      isNextOfKin: true,
      status: FamilyMemberStatus.ACTIVE,
    })
      .select("userId")
      .lean(),
    request.joinedVia === FamilyJoinSource.CODE
      ? FamilyCode.findOne({
          residentId: resident._id,
          createdAt: { $lte: request.requestedAt || now },
        })
          .sort({ createdAt: -1 })
          .select("createdBy createdAt")
          .lean()
      : null,
  ]);
  const [kinUser, sharedBy] = await Promise.all([
    nextOfKin
      ? User.findById(nextOfKin.userId).select("name profileIcon").lean()
      : null,
    code ? User.findById(code.createdBy).select("name").lean() : null,
  ]);

  const daysWaiting = Math.max(daysSince(request.requestedAt, now) ?? 0, 0);
  const room = residentInfo?.roomNumber || "";
  const relationship = request.relationship || "";
  const sharedName = sharedBy?.name || "";

  return {
    requestId: request._id,
    status: "pending",
    escalated: daysWaiting >= ESCALATE_AFTER_DAYS,
    requestedAt: request.requestedAt || null,
    daysWaiting,
    person: {
      name: person?.name || "",
      email: person?.email || "",
      photoUrl: person?.profileIcon || "",
    },
    resident: {
      residentId: resident._id,
      name: resident.name,
      roomNumber: room,
      photoUrl: residentInfo?.photoUrl || "",
      label: room ? `${resident.name} - RM ${room}` : resident.name,
    },
    relationship,
    relationshipLabel: titleCase(relationship),
    usedCode: code
      ? {
          sharedBy: sharedName,
          sharedAt: code.createdAt,
          label: [`Shared By ${sharedName}`.trim(), shortDate(code.createdAt)]
            .filter(Boolean)
            .join(", "),
        }
      : null,
    nextOfKin: nextOfKin
      ? {
          name: kinUser?.name || "",
          photoUrl: kinUser?.profileIcon || "",
          daysWaiting,
          label: daysWaiting >= 1 ? `No Answer For ${dayCount(daysWaiting)}` : "Awaiting Answer",
        }
      : { name: "", photoUrl: "", daysWaiting, label: "No Next Of Kin" },
  };
};

const clockTime = (value, timeZone) =>
  new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(new Date(value));

const personInFamily = async ({ session, residentId }) => {
  const person = await ExternalPerson.findById(session.externalPersonId)
    .select("userId email")
    .lean();
  const ids = [person?.userId].filter(Boolean);
  if (person?.email) {
    const account = await User.findOne({ email: String(person.email).toLowerCase() })
      .select("_id")
      .lean();
    if (account) ids.push(account._id);
  }
  if (!ids.length) return false;
  return Boolean(
    await FamilyMember.exists({
      residentId,
      userId: { $in: ids },
      status: FamilyMemberStatus.ACTIVE,
    }),
  );
};

const visitorEntryScreen = async (session, now = new Date()) => {
  const [resident, kiosk, hostProfile] = await Promise.all([
    session.residentId
      ? Resident.findById(session.residentId).select("name roomNumber").lean()
      : null,
    session.kioskId ? Kiosk.findById(session.kioskId).select("locationLabel").lean() : null,
    session.hostStaffId
      ? StaffProfile.findById(session.hostStaffId).select("userId").lean()
      : null,
  ]);
  const hostUser = hostProfile
    ? await User.findById(hostProfile.userId).select("name").lean()
    : null;

  const person = session.person || {};
  const timeZone = session.branch?.timezone || "Europe/London";
  const since = session.checkInAt || session.arrivedAt || session.createdAt;
  const minutes = since
    ? Math.max(Math.round((now.getTime() - new Date(since).getTime()) / 60000), 0)
    : 0;
  const typeLabel = titleCase(session.personType || "visitor");
  const invitation = session.method === VisitMethod.WALK_IN ? "No Invitation" : "Invited";
  const photoOnFile = Boolean(person.photoUrl);
  const room = resident?.roomNumber || "";
  const inFamily = resident
    ? await personInFamily({ session, residentId: resident._id })
    : false;
  const firstName = String(person.name || "").trim().split(/\s+/)[0] || "This person";

  return {
    visitor: {
      name: person.name || "",
      photoUrl: person.photoUrl || "",
      profileIcon: getFullImageUrl(person.photoUrl),
      typeLabel,
      invitationLabel: invitation,
      label: `${typeLabel} - ${invitation}`,
    },
    visiting: resident?.name || hostUser?.name || session.hostName || "",
    location: room ? `Room ${room}` : kiosk?.locationLabel || "",
    residentId: resident?._id || session.residentId || null,
    statedReason: session.purposeOfVisit || "",
    atKiosk: {
      since: since || null,
      time: since ? clockTime(since, timeZone) : "",
      minutes,
      label: since ? `${clockTime(since, timeZone)} - ${minutes} min` : "",
    },
    idCaptured: {
      onFile: photoOnFile,
      label: photoOnFile ? "Photo On File" : "Not Captured",
      photoUrl: person.photoUrl || "",
    },
    familyLink: resident
      ? {
          residentId: resident._id,
          residentName: resident.name,
          inFamily,
          message: inFamily
            ? ""
            : `${firstName} isn't in ${resident.name}'s Family Group. After approving you can invite them so next time they check in with a visit pass.`,
          openFamilyLabel: `Open ${resident.name}'s Family`,
        }
      : null,
    canDecide: session.status === VisitSessionStatus.AWAITING_APPROVAL,
  };
};

const hoursLabel = (value) => {
  const minutes = Math.round(Number(value || 0) * 60);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
};

const shiftDayLabel = (value, timeZone) =>
  new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone,
  })
    .format(new Date(value))
    .replace(",", "");

const shiftClaimScreen = async (claim) => {
  const shift = claim.shift;
  const [profile, branch] = await Promise.all([
    StaffProfile.findById(claim.staffId)
      .select("userId photoUrl jobTitleId contractedWeeklyHours")
      .lean(),
    Branch.findById(claim.branchId).select("name timezone").lean(),
  ]);
  const timeZone = branch?.timezone || "Europe/London";
  const weekStart = shift ? moment.tz(shift.startsAt, timeZone).startOf("isoWeek") : null;
  const [user, jobTitle, [week]] = await Promise.all([
    profile?.userId ? User.findById(profile.userId).select("profileIcon").lean() : null,
    profile?.jobTitleId ? JobTitle.findById(profile.jobTitleId).select("name").lean() : null,
    shift
      ? Shift.aggregate([
          {
            $match: {
              staffId: claim.staffId,
              status: { $in: [ShiftStatus.SCHEDULED, ShiftStatus.COMPLETED] },
              startsAt: {
                $gte: weekStart.toDate(),
                $lt: weekStart.clone().add(1, "week").toDate(),
              },
            },
          },
          {
            $group: {
              _id: null,
              hours: {
                $sum: { $divide: [{ $subtract: ["$endsAt", "$startsAt"] }, 3600000] },
              },
            },
          },
        ])
      : [],
  ]);

  const shiftHours = shift
    ? (new Date(shift.endsAt) - new Date(shift.startsAt)) / 3600000
    : 0;
  const bookedHours = week?.hours || 0;
  const contracted = Number(profile?.contractedWeeklyHours) || 0;

  return {
    staff: {
      ...(claim.staff || {}),
      photoUrl: profile?.photoUrl || user?.profileIcon || "",
      jobTitle: jobTitle?.name || "",
      subtitle: [jobTitle?.name, branch?.name].filter(Boolean).join(" - "),
    },
    shiftLabel: shift
      ? `${shiftDayLabel(shift.startsAt, timeZone)} - ${clockTime(shift.startsAt, timeZone)} - ${clockTime(shift.endsAt, timeZone)}`
      : "",
    hoursThisWeek: {
      bookedHours,
      shiftHours,
      totalHours: bookedHours + shiftHours,
      label: `${hoursLabel(bookedHours)} + ${hoursLabel(shiftHours)} = ${hoursLabel(bookedHours + shiftHours)}`,
    },
    contractedHours: { hours: contracted, label: hoursLabel(contracted) },
    visaHourCap: { hours: null, label: "None" },
    canDecide: claim.status === ShiftClaimStatus.PENDING,
  };
};

const cardFor = (tab, row, now) => {
  if (tab === "visitors") {
    const requester = row.requestedBy?.name || "Family member";
    return {
      title: `Visit Request · ${shortDate(row.startAt, { weekday: true })}`,
      subtitle: `${requester} · ${row.partySize || 1} People · ${row.residentName || "Resident"}`,
      badges: ["Request"],
    };
  }

  if (tab === "shifts") {
    const date = shortDate(row.shift?.startsAt, { weekday: true });
    const start = shortTime(row.shift?.startsAt);
    const end = shortTime(row.shift?.endsAt);
    return {
      title: `Shift Claim · ${[date, start && end ? `${start}–${end}` : ""].filter(Boolean).join(" ")}`,
      subtitle: [row.staff?.name, row.branch?.name].filter(Boolean).join(" · "),
      badges: ["Claim"],
    };
  }

  if (tab === "leave") {
    const label = LEAVE_LABELS[row.leaveType] || "Leave";
    const start = shortDate(row.startDate);
    const end = shortDate(row.endDate);
    const daysUntil = dayDistanceFromNow(row.startDate, now);
    const range = start && end && start !== end ? `${start}–${end}` : start;
    const subtitle = [
      row.staff?.name,
      `${row.totalDays || 0} Days`,
      daysUntil == null ? "" : daysUntil <= 0 ? "From Today" : `${daysUntil} Days Left`,
    ].filter(Boolean).join(" · ");
    return {
      title: `${label} · ${range}`,
      subtitle,
      badges: [row.leaveType === "sick" ? "Sickness" : "Leave"],
    };
  }

  if (tab === "photos") {
    const count = Array.isArray(row.photos) ? row.photos.length : 0;
    const relationship = row.authorRelationship
      ? row.authorRelationship.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase())
      : "Family Member";
    return {
      title: `${row.residentName || "Resident"}${row.roomNumber ? ` · RM ${row.roomNumber}` : ""}`,
      subtitle: `${count} ${count === 1 ? "Photo" : "Photos"} From ${row.authorName || "Family Member"} · ${relationship}`,
      badges: ["Pending", ...(row.residentHasPhotoConsent ? [] : ["No Consent"])],
      photoUrl: row.residentPhotoUrl || row.authorPhotoUrl || "",
      photos: row.photos || [],
    };
  }

  const daysWaiting = daysSince(row.requestedAt, now);
  const escalated = daysWaiting != null && daysWaiting >= ESCALATE_AFTER_DAYS;
  return {
    title: `${row.name || "Family member"} wants to join ${row.residentName || "resident"}'s family`,
    subtitle: escalated
      ? `Next of kin hasn't answered in ${daysWaiting} days`
      : [row.relationship, shortDate(row.requestedAt)].filter(Boolean).join(" · "),
    badges: [escalated ? "Escalated" : "Pending"],
  };
};

const shapeItem = (tab, row, now) => ({
  ...row,
  id: row.id || row._id || row.requestId || row.uploadId,
  tab,
  status: row.status || (tab === "visitors" ? "requested" : "pending"),
  createdAt: timestampOf(row),
  card: cardFor(tab, row, now),
});

const listSiteApprovals = async ({
  actor,
  organizationId,
  organization,
  isPlatformAdmin,
  branchId,
  tab = "all",
  page = 1,
  limit = 20,
  skip = (page - 1) * limit,
  now = new Date(),
}) => {
  const selectedTab = String(tab || "all")
    .trim()
    .toLowerCase();
  if (selectedTab !== "all" && !TAB_NAMES.includes(selectedTab)) {
    throw new AppError("invalid_approval_tab", 400, {
      validTabs: ["all", ...TAB_NAMES].join(","),
    });
  }

  const availability = availableTabs({ organization, isPlatformAdmin });
  if (selectedTab !== "all" && !availability[selectedTab]) {
    throw new AppError("approval_tab_module_not_enabled", 403);
  }

  const tabs =
    selectedTab === "all"
      ? TAB_NAMES.filter((name) => availability[name])
      : [selectedTab];
  if (selectedTab === "all" && page * limit > 500) {
    throw new AppError("approval_page_out_of_range", 400);
  }
  const candidateLimit =
    selectedTab === "all" ? Math.min(page * limit, 500) : limit;
  const candidatePage = selectedTab === "all" ? 1 : page;
  const candidateSkip = selectedTab === "all" ? 0 : skip;
  const common = {
    actor,
    organizationId,
    branchId,
    page: candidatePage,
    limit: candidateLimit,
    skip: candidateSkip,
  };

  const load = {
    visitors: () =>
      familyVisitService.listVisits({
        ...common,
        status: "requested",
        range: "upcoming",
        withVisiting: false,
      }),
    shifts: () => shiftService.listClaims({ ...common, status: "pending" }),
    leave: () =>
      leaveService.listLeaveRequests({ ...common, status: "pending" }),
    photos: () =>
      familyModerationService.listUploads({
        organizationId,
        branchId,
        status: "pending",
        residentMustExist: true,
        page: candidatePage,
        limit: candidateLimit,
        skip: candidateSkip,
      }),
    joins: () => familyStaffService.listJoinRequests(common),
  };

  const results = await Promise.all(
    tabs.map(async (name) => [name, await load[name]()]),
  );
  const resultByTab = new Map(results);
  const counts = Object.fromEntries(
    TAB_NAMES.map((name) => {
      const meta = resultByTab.get(name)?.meta;
      return [name, meta?.totalRecords ?? meta?.total ?? 0];
    }),
  );
  const rows = results.flatMap(([name, result]) =>
    (result.data || []).map((row) => shapeItem(name, row, now)),
  );

  if (selectedTab === "all") {
    rows.sort((a, b) => {
      const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bt - at;
    });
  }

  const totalRecords =
    selectedTab === "all"
      ? Object.values(counts).reduce((sum, count) => sum + count, 0)
      : counts[selectedTab];
  const data = selectedTab === "all" ? rows.slice(skip, skip + limit) : rows;

  return {
    data,
    meta: {
      tab: selectedTab,
      currentPage: page,
      limit,
      totalRecords,
      totalPages: Math.ceil(totalRecords / limit),
      counts,
      availableTabs: ["all", ...TAB_NAMES.filter((name) => availability[name])],
    },
  };
};

module.exports = { listSiteApprovals, getSiteApprovalDetail };
