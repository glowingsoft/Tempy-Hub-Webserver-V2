const { sendResponse, parsePaginationParams } = require("@utils/responseUtil");
const { respondByAction } = require("@utils/controllerResponse");
const residentService = require("@adminServices/residents/residentService");
const familyStaffService = require("@adminServices/family/familyStaffService");
const familyModerationService = require("@adminServices/family/familyModerationService");
const { handleServiceError } = require("@services/_errors/handleServiceError");

const respond = (translationKey, run) => async (req, res) => {
  try {
    const result = await run(req);
    const hasMeta = result && result.data !== undefined && "meta" in result;
    return sendResponse({
      res,
      statusCode: 200,
      translationKey,
      data: hasMeta ? result.data : result,
      meta: hasMeta ? result.meta : undefined,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const scope = (req) => ({
  actor: req.user,
  organizationId: req.orgId,
  residentId: req.params.residentId,
});

const listResidents = respond("data_fetched_successfully", (req) =>
  residentService.listManagerResidents({
    actor: req.user,
    organizationId: req.orgId,
    branchId: req.query.branchId,
    tab: req.query.tab,
    admissionStatus: req.query.admissionStatus,
    keyword: req.query.keyword,
    ...parsePaginationParams(req),
  }),
);

const getResident = respond("data_fetched_successfully", (req) =>
  residentService.getManagerResident(scope(req)),
);

const deactivateResident = respond("resident_deactivated", (req) =>
  residentService.deactivateResident({
    ...scope(req),
    reason: req.body.reason,
    message: req.body.message,
  }),
);

const getFamily = respond("data_fetched_successfully", (req) =>
  familyStaffService.getFamily(scope(req)),
);

const setNextOfKin = respond("next_of_kin_set", (req) =>
  familyStaffService.setNextOfKin({
    ...scope(req),
    memberId: req.body.memberId,
  }),
);

const removeFamilyMember = respond("family_member_removed", (req) =>
  familyStaffService.removeMember({
    ...scope(req),
    memberId: req.params.memberId,
  }),
);

const createFamilyCode = respond("family_code_created", (req) =>
  familyStaffService.createCode(scope(req)),
);

const setVisitingPassword = respond(
  "resident_passcode_updated_successfully",
  async (req) => {
    const resident = await residentService.setVisitorPasscode({
      ...scope(req),
      visitorPasscode: req.body.visitorPasscode,
    });
    return {
      visitingPassword: {
        required: Boolean(resident.visitorPasscodeRequired),
        setAt: resident.visitorPasscodeSetAt ?? null,
      },
    };
  },
);

const photoScope = (req) => ({
  ...scope(req),
  uploadId: req.params.uploadId,
});

const updateFamilyPhoto = respondByAction({
  approve: {
    run: (req) =>
      familyModerationService.approveUpload({
        ...photoScope(req),
        blur: req.body.blur,
      }),
    translationKey: "upload_approved",
  },
  reject: {
    run: (req) =>
      familyModerationService.rejectUpload({
        ...photoScope(req),
        reasonKey: req.body.reason,
        note: req.body.note,
      }),
    translationKey: "upload_rejected",
  },
});

module.exports = {
  listResidents,
  getResident,
  deactivateResident,
  getFamily,
  setNextOfKin,
  removeFamilyMember,
  createFamilyCode,
  setVisitingPassword,
  updateFamilyPhoto,
};
