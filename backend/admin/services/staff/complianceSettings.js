const mongoose = require("mongoose");
const { StaffProfile } = require("@models/StaffProfile");
const { Membership } = require("@models/Membership");
const { AppError } = require("@services/_errors/AppError");
const {
  StaffProfileStatus,
  MembershipRole,
  ActiveInactiveStatus,
} = require("@models/domainEnums");
const { actorStanding, assertMayManageStaff } = require("./staffAccess");
const {
  parseSupervisionInterval,
  parseAppraisalInterval,
  loadOrgCycleSettings,
  effectiveIntervals,
  assertAppraisalAfterSupervision,
} = require("@adminServices/appraisal/cycle");

const toObjectId = (value, key) => {
  if (!mongoose.Types.ObjectId.isValid(value)) {
    throw new AppError(key, 400);
  }
  return new mongoose.Types.ObjectId(String(value));
};

const loadStaff = async (staffId, organizationId) => {
  const staff = await StaffProfile.findOne({
    _id: staffId,
    organizationId,
    status: StaffProfileStatus.ACTIVE,
  }).lean();
  if (!staff) throw new AppError("staff_profile_not_found", 404);
  return staff;
};

const hasComplianceFields = ({
  supervisorStaffId,
  supervisionIntervalMonths,
  appraisalIntervalMonths,
}) =>
  supervisorStaffId !== undefined ||
  supervisionIntervalMonths !== undefined ||
  appraisalIntervalMonths !== undefined;

const applyComplianceFields = async (
  staff,
  {
    organizationId,
    supervisorStaffId,
    supervisionIntervalMonths,
    appraisalIntervalMonths,
  }
) => {
  if (supervisorStaffId !== undefined) {
    if (!supervisorStaffId) {
      staff.supervisorStaffId = null;
    } else {
      if (String(supervisorStaffId) === String(staff._id)) {
        throw new AppError("cannot_supervise_self", 400);
      }
      const supervisor = await loadStaff(
        toObjectId(supervisorStaffId, "invalid_staff_profile_id"),
        organizationId
      );
      if (String(supervisor.branchId) !== String(staff.branchId)) {
        throw new AppError("outside_managed_branch", 400);
      }
      const isLineManager = await Membership.exists({
        userId: supervisor.userId,
        organizationId,
        role: MembershipRole.LINE_MANAGER,
        status: ActiveInactiveStatus.ACTIVE,
      });
      if (!isLineManager) throw new AppError("supervisor_must_be_line_manager", 400);
      staff.supervisorStaffId = supervisor._id;
    }
  }

  if (supervisionIntervalMonths !== undefined) {
    staff.supervisionIntervalMonths = supervisionIntervalMonths
      ? parseSupervisionInterval(supervisionIntervalMonths)
      : null;
  }

  if (appraisalIntervalMonths !== undefined) {
    staff.appraisalIntervalMonths = appraisalIntervalMonths
      ? parseAppraisalInterval(appraisalIntervalMonths)
      : null;
  }

  if (
    supervisionIntervalMonths !== undefined ||
    appraisalIntervalMonths !== undefined
  ) {
    const pair = effectiveIntervals(staff, await loadOrgCycleSettings(organizationId));
    assertAppraisalAfterSupervision(pair.appraisalMonths, pair.supervisionMonths);
  }
};

const updateStaffComplianceSettings = async ({
  actor,
  organizationId,
  staffProfileId,
  supervisorStaffId,
  supervisionIntervalMonths,
  appraisalIntervalMonths,
}) => {
  if (
    !hasComplianceFields({
      supervisorStaffId,
      supervisionIntervalMonths,
      appraisalIntervalMonths,
    })
  ) {
    throw new AppError("nothing_to_update", 400);
  }

  const staff = await loadStaff(
    toObjectId(staffProfileId, "invalid_staff_profile_id"),
    organizationId
  );
  const standing = await actorStanding(actor, organizationId);
  assertMayManageStaff(standing, staff.branchId);

  await applyComplianceFields(staff, {
    organizationId,
    supervisorStaffId,
    supervisionIntervalMonths,
    appraisalIntervalMonths,
  });

  await StaffProfile.updateOne(
    { _id: staff._id },
    {
      $set: {
        supervisorStaffId: staff.supervisorStaffId,
        supervisionIntervalMonths: staff.supervisionIntervalMonths,
        appraisalIntervalMonths: staff.appraisalIntervalMonths,
      },
    }
  );

  return {
    _id: staff._id,
    supervisorStaffId: staff.supervisorStaffId,
    supervisionIntervalMonths: staff.supervisionIntervalMonths,
    appraisalIntervalMonths: staff.appraisalIntervalMonths,
  };
};

module.exports = {
  hasComplianceFields,
  applyComplianceFields,
  updateStaffComplianceSettings,
};
