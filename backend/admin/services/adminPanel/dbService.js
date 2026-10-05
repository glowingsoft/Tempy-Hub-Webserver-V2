const { bulkInsert, deleteCollection } = require("@utils/dbUtils");
const { AppError } = require("@services/_errors/AppError");

const bulkInsertDocuments = async ({ values, collectionName }) => {
  if (!values || !Array.isArray(values) || values.length === 0) {
    throw new AppError("values_array", 400);
  }

  if (!collectionName) {
    throw new AppError("collection_name", 400);
  }

  return bulkInsert(values, collectionName);
};

const deleteAllDocuments = async ({ collectionName }) => {
  if (!collectionName) {
    throw new AppError("collection_name", 400);
  }

  return deleteCollection(collectionName);
};

module.exports = {
  bulkInsertDocuments,
  deleteAllDocuments,
};
