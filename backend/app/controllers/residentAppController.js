const { sendResponse, parsePaginationParams } = require("@utils/responseUtil");
const { handleServiceError } = require("@services/_errors/handleServiceError");
const residentFamilyService = require("@appServices/residents/residentFamilyService");
const residentPhotoService = require("@appServices/residents/residentPhotoService");
const residentGazetteService = require("@appServices/residents/residentGazetteService");
const residentVisitorService = require("@appServices/residents/residentVisitorService");
const residentHomeService = require("@appServices/residents/residentHomeService");
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

module.exports = {
  getHomeScreen,
  listGazettes,
  getGazette,
  getVisitorsScreen,
  getFamilyScreen,
  getPhotosScreen,
  getPhotoScreen,
  getGazetteScreen,
};
