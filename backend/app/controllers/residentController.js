const { sendResponse, parsePaginationParams } = require("@utils/responseUtil");
const { respondByAction } = require("@utils/controllerResponse");
const residentService = require("@adminServices/residents/residentService");
const residentScreenService = require("@adminServices/residents/residentScreenService");
const residentAccountService = require("@adminServices/residents/residentAccountService");
const peepRecordService = require("@adminServices/peep/peepRecordService");
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

const getResidentScreen = respond("data_fetched_successfully", async (req) => {
  const tab = String(req.query.tab || "profile")
    .trim()
    .toLowerCase();
  const residentScope = scope(req);
  const resident = await residentService.getManagerResident(residentScope);

  if (tab === "profile") {
    return {
      tab,
      resident,
      details: {
        residentId: resident._id,
        roomNumber: resident.roomNumber,
        admissionStatus: resident.admissionStatus,
        careLevel: resident.careLevel,
        movedInAt: resident.admittedAt ?? null,
        inHome: !resident.out?.active,
        restrictedContacts: resident.restriction?.active ?? false,
      },
      ...(await residentScreenService.profileScreen({ resident })),
      account: await residentAccountService.getAccountState(resident._id),
    };
  }

  if (tab === "peep") {
    const peep = await peepRecordService.getPeepRecordByResident(residentScope);
    return {
      tab,
      resident: { _id: resident._id, name: resident.name },
      peep,
      ...residentScreenService.peepScreen({ resident, peep }),
    };
  }

  if (tab === "family") {
    const family = await familyStaffService.getFamily(residentScope);
    const screen = residentScreenService.familyScreen({ family });
    return {
      tab,
      resident: family.resident,
      family: { ...family, ...screen },
    };
  }

  const { AppError } = require("@services/_errors/AppError");
  throw new AppError("invalid_resident_screen_tab", 400, {
    validTabs: "profile,peep,family",
  });
});

const getPeepRecord = respond("data_fetched_successfully", (req) =>
  peepRecordService.getPeepRecordByResident({
    actor: req.user,
    organizationId: req.orgId,
    residentId: req.params.residentId,
  }),
);

const deactivateResident = respond("resident_deactivated", (req) =>
  residentService.deactivateResident({
    ...scope(req),
    reason: req.body.reason,
    message: req.body.message,
  }),
);

const sendAccountInvitation = respond("invitation_sent_successfully", (req) =>
  residentAccountService.sendAccountInvitation({
    ...scope(req),
    email: req.body?.email,
  }),
);

const removeAccount = respond("resident_account_removed", (req) =>
  residentAccountService.removeAccount(scope(req)),
);

const getFamily = respond("data_fetched_successfully", async (req) => {
  const family = await familyStaffService.getFamily(scope(req));
  return {
    ...family,
    familyCode: {
      hasFamilyCode: Boolean(family.familyCode.code),
      ...family.familyCode,
    },
  };
});

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

const getFamilyCode = respond("data_fetched_successfully", (req) =>
  familyStaffService.getCode(scope(req)),
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
  getResidentScreen,
  getPeepRecord,
  deactivateResident,
  sendAccountInvitation,
  removeAccount,
  getFamily,
  setNextOfKin,
  removeFamilyMember,
  getFamilyCode,
  createFamilyCode,
  setVisitingPassword,
  updateFamilyPhoto,
};
