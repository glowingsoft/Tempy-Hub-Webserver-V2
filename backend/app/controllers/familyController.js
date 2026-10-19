const { sendResponse } = require("@utils/responseUtil");
const familyAccessService = require("@appServices/family/familyAccessService");
const { handleServiceError } = require("@services/_errors/handleServiceError");

/** Who am I viewing? Drives the resident picker and the header dropdown. */
const listMyResidents = async (req, res) => {
  try {
    const data = await familyAccessService.resolveFamilyResidents(req.user._id, {
      activeResidentId: req.query.residentId,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "data_fetched_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

/** Options for the Relationship dropdowns. */
const listRelationships = async (req, res) => {
  try {
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "data_fetched_successfully",
      data: familyAccessService.listRelationships(),
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

module.exports = { listMyResidents, listRelationships };
