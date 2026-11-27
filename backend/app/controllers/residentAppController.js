const { sendResponse, parsePaginationParams } = require("@utils/responseUtil");
const { handleServiceError } = require("@services/_errors/handleServiceError");
const residentFamilyService = require("@appServices/residents/residentFamilyService");
const residentPhotoService = require("@appServices/residents/residentPhotoService");
const residentGazetteService = require("@appServices/residents/residentGazetteService");
const residentVisitorService = require("@appServices/residents/residentVisitorService");
const residentHomeService = require("@appServices/residents/residentHomeService");
const residentNewsletterService = require("@appServices/residents/residentNewsletterService");
const residentWallService = require("@appServices/residents/residentWallService");
const residentProfileService = require("@appServices/residents/residentProfileService");
const { pagedDetail } = require("./familyController");

const getFamilyScreen = async (req, res) => {
  try {
    const data = await residentFamilyService.getFamilyScreen({
      resident: req.resident,
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

const getPhotosScreen = async (req, res) => {
  try {
    const { data, meta } = await residentPhotoService.getPhotosScreen({
      resident: req.resident,
      tab: req.query.tab,
      ...parsePaginationParams(req),
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

const getPhotoScreen = async (req, res) => {
  try {
    const data = await residentPhotoService.getPhotoScreen({
      resident: req.resident,
      mediaId: req.params.mediaId,
      tab: req.query.tab,
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

const getGazetteScreen = pagedDetail("messages", (req) =>
  residentGazetteService.getGazetteScreen({ resident: req.resident }),
);

const getVisitorsScreen = async (req, res) => {
  try {
    const { data, meta } = await residentVisitorService.getVisitorsScreen({
      resident: req.resident,
      ...parsePaginationParams(req),
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

const listGazettes = async (req, res) => {
  try {
    const { data, meta } = await residentGazetteService.listGazettes({
      resident: req.resident,
      ...parsePaginationParams(req),
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

const getGazette = pagedDetail("messages", (req) =>
  residentGazetteService.getGazetteById({
    resident: req.resident,
    gazetteId: req.params.gazetteId,
  }),
);

const getHomeScreen = async (req, res) => {
  try {
    const data = await residentHomeService.getHomeScreen({
      resident: req.resident,
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

const getNewsletterScreen = pagedDetail("highlights", (req) =>
  residentNewsletterService.getNewsletterScreen({ resident: req.resident }),
);

const listWall = async (req, res) => {
  try {
    const { data, meta } = await residentWallService.listWall({
      resident: req.resident,
      userId: req.user._id,
      ...parsePaginationParams(req),
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

const getProfileScreen = async (req, res) => {
  try {
    const data = await residentProfileService.getProfileScreen({
      resident: req.resident,
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

const updateProfileSettings = async (req, res) => {
  try {
    const data = await residentProfileService.updateProfileSettings({
      resident: req.resident,
      userId: req.user._id,
      settings: req.body,
    });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "resident_settings_saved",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

module.exports = {
  getProfileScreen,
  updateProfileSettings,
  listWall,
  getNewsletterScreen,
  getHomeScreen,
  listGazettes,
  getGazette,
  getVisitorsScreen,
  getFamilyScreen,
  getPhotosScreen,
  getPhotoScreen,
  getGazetteScreen,
};
