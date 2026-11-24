const { FamilyMember } = require("@models/FamilyMember");
const { FloorPlanPin } = require("@models/FloorPlanPin");
const { FloorPlan } = require("@models/FloorPlan");
const { VisitSession } = require("@models/VisitSession");
const { ExternalPerson } = require("@models/ExternalPerson");
const { User } = require("@models/UserModel");
const {
  FamilyMemberStatus,
  PeepConsentStatus,
} = require("@models/domainEnums");

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const formatDate = (value, { year = true } = {}) => {
  if (!value || Number.isNaN(new Date(value).getTime())) return "";
  const date = new Date(value);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}${year ? ` ${date.getUTCFullYear()}` : ""}`;
};

const formatTime = (value) =>
  new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC",
  }).format(new Date(value));

const titleCase = (value) =>
  String(value || "")
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (letter) => letter.toUpperCase());

const row = (key, label, value) => ({
  key,
  label,
  value: value === undefined || value === "" ? null : value,
});

const floorOf = async (residentId) => {
  const pin = await FloorPlanPin.findOne({ residentId })
    .sort({ updatedAt: -1 })
    .select("floorPlanId")
    .lean();
  if (!pin) return { pinned: false, floorPlanName: "" };
  const plan = await FloorPlan.findById(pin.floorPlanId).select("name").lean();
  return { pinned: true, floorPlanName: plan?.name || "" };
};

const floorLabel = (floorPlanName) =>
  String(floorPlanName || "").replace(/\s+plan$/i, "");

const profileScreen = async ({ resident }) => {
  const [floor, kin, visits] = await Promise.all([
    floorOf(resident._id),
    FamilyMember.findOne({
      residentId: resident._id,
      isNextOfKin: true,
      status: FamilyMemberStatus.ACTIVE,
    })
      .select("userId relationship")
      .lean(),
    (() => {
      const start = new Date();
      start.setUTCHours(0, 0, 0, 0);
      return VisitSession.find({ residentId: resident._id, checkInAt: { $gte: start } })
        .sort({ checkInAt: 1 })
        .select("externalPersonId checkInAt")
        .lean();
    })(),
  ]);

  const [kinUser, people] = await Promise.all([
    kin ? User.findById(kin.userId).select("name phoneNumber profileIcon").lean() : null,
    visits.length
      ? ExternalPerson.find({ _id: { $in: visits.map((visit) => visit.externalPersonId) } })
          .select("name")
          .lean()
      : [],
  ]);
  const nameById = new Map(people.map((person) => [String(person._id), person.name]));
  const visitors = visits.map((visit) => ({
    name: nameById.get(String(visit.externalPersonId)) || "",
    time: formatTime(visit.checkInAt),
  }));

  const floorName = floorLabel(floor.floorPlanName);
  const chips = [
    resident.out?.active
      ? { key: "out", label: "Out" }
      : { key: "inHome", label: "In the home" },
    ...(resident.restriction?.active
      ? [{ key: "restrictedContacts", label: "Restricted contacts" }]
      : []),
  ];

  return {
    header: {
      name: resident.name,
      photoUrl: resident.photoUrl || "",
      location: [resident.roomNumber ? `Room ${resident.roomNumber}` : "", floorName]
        .filter(Boolean)
        .join(" · "),
      chips,
    },
    detailRows: [row("movedIn", "Moved in", formatDate(resident.admittedAt))],
    careNotes: {
      rows: [row("mobility", "Mobility", resident.peep?.mobility)],
    },
    nextOfKin: kinUser
      ? {
          name: kinUser.name || "",
          photoUrl: kinUser.profileIcon || "",
          relationship: kin.relationship || "",
          phone: kinUser.phoneNumber || "",
          label: [titleCase(kin.relationship), kinUser.phoneNumber].filter(Boolean).join(" · "),
        }
      : null,
    today: {
      visitors,
      label: visitors.length
        ? `${visitors.length} ${visitors.length === 1 ? "visitor" : "visitors"} (${visitors
            .map((visit) => `${visit.name}, ${visit.time}`)
            .join("; ")})`
        : "No visitors today",
    },
  };
};

const consentLabel = (peep) => {
  if (peep.consentStatus === PeepConsentStatus.MCA_BI) {
    const when = formatDate(peep.lastReviewedAt || peep.updatedAt, { year: false });
    return ["Best-Interest Decision", when].filter(Boolean).join(" ");
  }
  return peep.consentStatus ? "Consent Given" : null;
};

const peepScreen = ({ resident, peep }) => {
  const floorName = peep.floor || "";
  const pinned = Boolean(peep.pin);
  const room = resident.roomNumber ? `Room ${resident.roomNumber}` : "";
  return {
    floorPlanCard: {
      title: floorName,
      subtitle: [
        room ? `${room} ${pinned ? "pinned" : "not pinned"}` : "",
        peep.primaryRoute ? `Nearest exit: ${peep.primaryRoute}` : "",
      ]
        .filter(Boolean)
        .join(" · "),
      floorPlanId: peep.floorPlanId || null,
      pinned,
    },
    rows: [
      row("mobility", "Mobility", peep.mobilityNotes),
      row("staffNeeded", "Staff Needed", peep.assistanceRequired),
      row("equipment", "Equipment", peep.equipmentRequired),
      row("hearing", "Hearing", peep.supportNeeds),
      row("consent", "Consent / MCA", consentLabel(peep)),
      row("nextReview", "Next Review", formatDate(peep.reviewDueAt, { year: false })),
    ],
  };
};

const memberTag = (member) => {
  if (member.status === FamilyMemberStatus.PENDING) return { key: "review", label: "Review" };
  if (member.isNextOfKin) return { key: "nextOfKin", label: "Next Of Kin" };
  return { key: "remove", label: "Remove" };
};

const familyScreen = ({ family }) => {
  const sharing = family.photoSharing || {};
  const who = String(sharing.agreedBy || "").trim().split(/\s+/)[0];
  const agreed = sharing.agreed
    ? [
        `Agreed by ${who || "resident"}`,
        formatDate(sharing.agreedAt),
        sharing.recordedBy ? `Recorded by ${sharing.recordedBy}` : "",
      ]
        .filter(Boolean)
        .join(" - ")
    : "Not agreed";
  return {
    photoSharing: { ...sharing, label: agreed },
    members: (family.members || []).map((member) => ({
      ...member,
      requestId: member.status === FamilyMemberStatus.PENDING ? member.memberId : null,
      subtitle: [
        titleCase(member.relationship),
        member.status === FamilyMemberStatus.PENDING ? "Waiting" : "",
      ]
        .filter(Boolean)
        .join(" - "),
      tag: memberTag(member),
    })),
  };
};

module.exports = { profileScreen, peepScreen, familyScreen };
