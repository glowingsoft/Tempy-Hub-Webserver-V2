const { sendResponse } = require("@utils/responseUtil");
const { handleServiceError } = require("@services/_errors/handleServiceError");
const {
  findResidentAccount,
} = require("@appServices/residents/residentAccessService");

const requireResidentAccess = async (req, res, next) => {
  try {
    const resident = await findResidentAccount(req.user._id);
    if (!resident) {
      return sendResponse({
        res,
        statusCode: 403,
        translationKey: "resident_profile_not_found",
      });
    }
    req.resident = resident;
    return next();
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

module.exports = { requireResidentAccess };
