const { sendResponse, parsePaginationParams } = require("@utils/responseUtil");
const evacuationService = require("@adminServices/evacuation/evacuationService");
const evacuationScreenService = require("@adminServices/evacuation/evacuationScreenService");
const { respond } = require("@utils/controllerResponse");
const { handleServiceError } = require("@services/_errors/handleServiceError");
const {
  EvacCheckStatus,
  MembershipRole,
} = require("@models/domainEnums");

const ROLLCALL_ROLES = [
  MembershipRole.SUPER_ADMIN,
  MembershipRole.OWNER,
  MembershipRole.SITE_MANAGER,
];

const myDrills = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const { data, meta } = await evacuationService.myDrills({
      actor: req.user,
      organizationId: req.orgId,
      page,
      limit,
      skip,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "data_fetched_successfully",
      data,
      meta,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

/** Active evacuation of a branch; managers also get the roll call, one page of unaccounted people at a time. */
const getActiveEvacuation = async (req, res) => {
  try {
    const role = req.membership?.role;
    const data = await evacuationService.getActiveEvacuation({
      organizationId: req.orgId,
      branchId: req.query.branchId,
      type: req.query.type,
      includeStats: false,
      selfUserId: req.user._id,
      // a site manager sees their own site, the only one whose roll call they may open
      ...(role === MembershipRole.SITE_MANAGER ? { actor: req.user } : {}),
    });

    const runsRollcall = req.isPlatformAdmin || ROLLCALL_ROLES.includes(role);
    const rollcall =
      runsRollcall && data?._id
        ? await evacuationService.getRollcall({
            organizationId: req.orgId,
            evacuationEventId: data._id,
            actor: req.user,
            status: req.query.status,
            personKind: req.query.personKind,
            ...parsePaginationParams(req),
          })
        : null;

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "data_fetched_successfully",
      data: data?._id
        ? await evacuationScreenService.presentActive({
            data: rollcall ? { ...data, ...rollcall.data } : data,
          })
        : (data ?? {}),
      ...(rollcall ? { meta: rollcall.meta } : {}),
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

/**
 * Staff self mark — Safe at assembly → safe, smoke waiting → unknown,
 * I'm not on site → offSite.
 */
const markMyself = async (req, res) => {
  try {
    const data = await evacuationService.markSelfCheck({
      organizationId: req.orgId,
      userId: req.user._id,
      branchId: req.body.branchId,
      status: req.body.status || EvacCheckStatus.SAFE,
      locationLabel: req.body.locationLabel,
      geo: req.body.geo,
      clientEventId: req.body.clientEventId,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "evac_check_saved",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const familyMessage = (action, translationKey) => async (req, res) => {
  try {
    const data = await evacuationService[action]({
      organizationId: req.orgId,
      evacuationEventId: req.params.evacuationEventId,
      actor: req.user,
      presets: req.body.presets,
    });

    return sendResponse({ res, statusCode: 200, translationKey, data });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const alertFamilies = familyMessage("alertFamilies", "families_alerted");
const updateFamilies = familyMessage("updateFamilies", "families_updated");
const allClearFamilies = familyMessage(
  "allClearFamilies",
  "families_all_clear_sent"
);

const getFireDrills = respond((req) =>
  evacuationScreenService.getFireDrills({
    actor: req.user,
    organizationId: req.orgId,
    branchId: req.query.branchId,
    ...parsePaginationParams(req),
  }),
);

const raiseEvacuation = respond(
  async (req) => {
    const { type, drillKind, branchId } = req.body || {};
    evacuationScreenService.assertDrillKind(drillKind);
    const event = await evacuationService.startEvacuation({
      organizationId: req.orgId,
      branchId,
      type,
      startedByUserId: req.user._id,
      actor: req.user,
    });
    await evacuationScreenService.setDrillKind({ evacuationEventId: event._id, kind: drillKind });
    const usersAlerted = await evacuationScreenService.alertAppUsers({
      actor: req.user,
      organizationId: req.orgId,
      event,
    });
    return { ...event, ...(drillKind ? { drillKind } : {}), usersAlerted };
  },
  { statusCode: 201, translationKey: "evacuation_started" },
);

const logDrill = respond(
  (req) =>
    evacuationScreenService.logDrill({
      actor: req.user,
      organizationId: req.orgId,
      branchId: req.body?.branchId,
      body: req.body,
    }),
  { statusCode: 201, translationKey: "drill_logged" },
);

module.exports = {
  getFireDrills,
  raiseEvacuation,
  logDrill,
  myDrills,
  getActiveEvacuation,
  markMyself,
  alertFamilies,
  updateFamilies,
  allClearFamilies,
};
