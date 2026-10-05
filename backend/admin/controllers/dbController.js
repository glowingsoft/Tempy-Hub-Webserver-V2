const { sendResponse, validateParams } = require("@utils/responseUtil");
const dbService = require("@adminServices/adminPanel/dbService");
const { handleServiceError } = require("@services/_errors/handleServiceError");

const bulkInsertHandler = async (req, res) => {
  const validationOptions = {
    rawData: ["values", "collectionName"],
  };
  if (!validateParams(req, res, validationOptions)) return;

  const { values, collectionName } = req.body;

  try {
    const result = await dbService.bulkInsertDocuments({
      values,
      collectionName,
    });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: `Inserted ${result.length} documents into ${collectionName} collection`,
      data: result,
    });
  } catch (error) {
    return handleServiceError(res, error, "error_during");
  }
};

const deleteCollectionHandler = async (req, res) => {
  const validationOptions = {
    rawData: ["collectionName"],
  };
  if (!validateParams(req, res, validationOptions)) return;

  const { collectionName } = req.body;

  try {
    const result = await dbService.deleteAllDocuments({ collectionName });
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: `Deleted all documents from ${collectionName} collection`,
      data: result,
    });
  } catch (error) {
    return handleServiceError(res, error, "error_during_1");
  }
};

module.exports = {
  deleteCollectionHandler,
  bulkInsertHandler,
};
