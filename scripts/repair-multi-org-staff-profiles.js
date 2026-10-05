require("dotenv").config({ path: require("path").join(__dirname, "..", ".env.dev") });

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
const { StaffInvitationStatus } = require("@models/domainEnums");
const staffService = require("@adminServices/staff/staffService");

(async () => {
  await mongoose.connect(process.env.BASE_URL);

  try {
    await StaffProfile.collection.dropIndex("userId_1");
    console.log("dropped userId_1");
  } catch (e) {
    console.log("drop userId_1:", e.codeName || e.message);
  }

  await StaffProfile.syncIndexes();
  console.log("indexes synced");

  const accepted = await StaffInvitation.find({
    status: StaffInvitationStatus.ACCEPTED,
    acceptedByUserId: { $ne: null },
    jobTitleId: { $ne: null },
    branchId: { $ne: null },
  })
    .select(
      "acceptedByUserId organizationId branchId jobTitleId departmentIds reportsToStaffId startDate employeeCode email"
    )
    .lean();

  let repaired = 0;
  for (const inv of accepted) {
    const created = await staffService.insertStaffProfile({
      userId: inv.acceptedByUserId,
      organizationId: inv.organizationId,
      branchId: inv.branchId,
      jobTitleId: inv.jobTitleId,
      departmentIds: inv.departmentIds,
      reportsToStaffId: inv.reportsToStaffId,
      startDate: inv.startDate || new Date(),
      employeeCode: inv.employeeCode,
    });
    if (created) {
      repaired += 1;
      console.log(
        "created profile for",
        inv.email,
        "org",
        String(inv.organizationId),
        "branch",
        String(inv.branchId)
      );
    }
  }
  console.log("repaired", repaired);

  const uid = new mongoose.Types.ObjectId("6a957bd94f38edb8df164107");
  const profiles = await StaffProfile.find({ userId: uid })
    .select("organizationId branchId employeeCode")
    .lean();
  console.log("new.carer profiles", JSON.stringify(profiles, null, 2));

  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
