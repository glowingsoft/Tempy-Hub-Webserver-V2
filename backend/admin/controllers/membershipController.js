const {
  sendResponse,
  validateParams,
  parsePaginationParams,
} = require("@utils/responseUtil");
const membershipService = require("@adminServices/organizations/membershipService");
const { handleServiceError } = require("@services/_errors/handleServiceError");

const listMembers = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const { data, meta } = await membershipService.listMembers({
      organizationId: req.orgId,
      page,
      limit,
      skip,
      keyword: req.query.keyword,
      role: req.query.role,
      branchId: req.query.branchId,
      status: req.query.status,
      hasStaffProfile: req.query.hasStaffProfile,
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

const listGrantablePermissions = async (req, res) => {
  try {
    const data = await membershipService.listGrantablePermissions({
      actor: req.user,
      organizationId: req.orgId,
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

const getMembership = async (req, res) => {
  if (!validateParams(req, res, { objectIdFields: ["membershipId"] })) return;

  try {
    const data = await membershipService.getMembership({
      membershipId: req.params.membershipId,
      organizationId: req.orgId,
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

const updateMembership = async (req, res) => {
  try {
    const data = await membershipService.updateMembership({
      actor: req.user,
      membershipId: req.params.membershipId,
      organizationId: req.orgId,
      role: req.body.role,
      branchId: req.body.branchId,
      permissions: req.body.permissions,
      status: req.body.status,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "membership_updated_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const deactivateMembership = async (req, res) => {
  try {
    const data = await membershipService.deactivateMembership({
      actor: req.user,
      membershipId: req.params.membershipId,
      organizationId: req.orgId,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "membership_deactivated_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const inviteMember = async (req, res) => {
  if (!validateParams(req, res, { formFields: ["email", "role"] })) return;

  try {
    const data = await membershipService.inviteMember({
      actor: req.user,
      organizationId: req.params.organizationId || req.orgId,
      email: req.body.email,
      name: req.body.name,
      role: req.body.role,
      branchId: req.body.branchId,
      permissions: req.body.permissions,
      jobTitleId: req.body.jobTitleId,
      departmentIds: req.body.departmentIds,
      reportsToStaffId: req.body.reportsToStaffId,
      startDate: req.body.startDate,
      employeeCode: req.body.employeeCode,
    });

    return sendResponse({
      res,
      statusCode: 201,
      translationKey: "invitation_sent_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const listInvitations = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req);
    const { data, meta } = await membershipService.listInvitations({
      organizationId: req.orgId,
      page,
      limit,
      skip,
      status: req.query.status,
      keyword: req.query.keyword,
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

const getInvitation = async (req, res) => {
  if (!validateParams(req, res, { objectIdFields: ["invitationId"] })) return;

  try {
    const data = await membershipService.getInvitation({
      invitationId: req.params.invitationId,
      organizationId: req.orgId,
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

const updateInvitation = async (req, res) => {
  try {
    const data = await membershipService.updateInvitation({
      actor: req.user,
      invitationId: req.params.invitationId,
      organizationId: req.orgId,
      name: req.body.name,
      role: req.body.role,
      branchId: req.body.branchId,
      permissions: req.body.permissions,
      jobTitleId: req.body.jobTitleId,
      departmentIds: req.body.departmentIds,
      reportsToStaffId: req.body.reportsToStaffId,
      startDate: req.body.startDate,
      employeeCode: req.body.employeeCode,
      isBranchManager: req.body.isBranchManager,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "invitation_updated_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const resendInvitation = async (req, res) => {
  try {
    const data = await membershipService.resendInvitation({
      actor: req.user,
      invitationId: req.params.invitationId,
      organizationId: req.orgId,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "invitation_sent_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

const revokeInvitation = async (req, res) => {
  try {
    const data = await membershipService.revokeInvitation({
      actor: req.user,
      invitationId: req.params.invitationId,
      organizationId: req.orgId,
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "invitation_revoked_successfully",
      data,
    });
  } catch (error) {
    return handleServiceError(res, error, "some_thing_went_wrong");
  }
};

module.exports = {
  listMembers,
  listGrantablePermissions,
  getMembership,
  updateMembership,
  deactivateMembership,
  inviteMember,
  listInvitations,
  getInvitation,
  updateInvitation,
  resendInvitation,
  revokeInvitation,
};
