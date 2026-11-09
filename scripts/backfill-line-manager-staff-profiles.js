require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const path = require("path");
const moduleAlias = require("module-alias");
const aliases = require("../aliasConfig/pathAliases.config");
for (const [alias, target] of Object.entries(aliases)) {
  moduleAlias.addAlias(alias, path.join(__dirname, "..", target));
}
require("module-alias/register");

const mongoose = require("mongoose");
const { StaffProfile } = require("@models/StaffProfile");
const { StaffInvitation } = require("@models/StaffInvitation");
const { MembershipRole, StaffInvitationStatus } = require("@models/domainEnums");
const staffService = require("@adminServices/staff/staffService");

(async () => {
  await mongoose.connect(process.env.BASE_URL);

  const accepted = await StaffInvitation.find({
    status: StaffInvitationStatus.ACCEPTED,
    role: MembershipRole.LINE_MANAGER,
    acceptedByUserId: { $ne: null },
    branchId: { $ne: null },
  })
    .select(
      "acceptedByUserId organizationId branchId jobTitleId departmentIds reportsToStaffId startDate employeeCode email"
    )
    .lean();

  let created = 0;
  for (const inv of accepted) {
    const exists = await StaffProfile.exists({
      userId: inv.acceptedByUserId,
      organizationId: inv.organizationId,
    });
    if (exists) continue;

    const profile = await staffService.insertStaffProfile({
      userId: inv.acceptedByUserId,
      organizationId: inv.organizationId,
      branchId: inv.branchId,
      jobTitleId: inv.jobTitleId,
      departmentIds: inv.departmentIds,
      reportsToStaffId: inv.reportsToStaffId,
      startDate: inv.startDate || new Date(),
      employeeCode: inv.employeeCode,
      role: MembershipRole.LINE_MANAGER,
    });
    if (profile) {
      created += 1;
      console.log("created", inv.email, String(profile._id));
    }
  }

  console.log("createdCount", created);
  await mongoose.disconnect();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
