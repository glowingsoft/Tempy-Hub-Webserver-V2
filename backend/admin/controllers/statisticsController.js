const mongoose = require("mongoose");
const { sendResponse } = require("@utils/responseUtil");
const { handleServiceError } = require("@services/_errors/handleServiceError");
const statisticsService = require("@adminServices/statistics/statisticsService");

const getStatistics = async (req, res) => {
  const branchId = req.query.branchId;
  if (branchId && !mongoose.Types.ObjectId.isValid(branchId)) {
    return sendResponse({ res, statusCode: 400, translationKey: "invalid_branch_id" });
  }

  const year = req.query.year ? Number(req.query.year) : new Date().getUTCFullYear();
  if (!Number.isInteger(year)) {
    return sendResponse({ res, statusCode: 400, translationKey: "invalid_statistics_year" });
  }

  try {
    const data = await statisticsService.getStatistics({
      organizationId: req.orgId,
      requestedBranchId: branchId,
      role: req.membership?.role,
      membershipBranchId: req.membership?.branchId,
      year,
      period: req.query.period || "thisQuarter",
    });
    return sendResponse({ res, statusCode: 200, translationKey: "data_fetched_successfully", data });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

module.exports = { getStatistics };
