/**
 * One-off: merge default staff permissions onto existing staff / lineManager
 * memberships (invite already does this for new people).
 *
 * Skips owner / siteManager (empty permissions is correct for those roles).
 * Does not wipe extra keys already on the membership.
 *
 *   node backend/scripts/backfillStaffDefaultPermissions.js
 */
require("dotenv").config({
  path: require("path").join(__dirname, "..", "..", ".env"),
});

const path = require("path");
const moduleAlias = require("module-alias");
const aliases = require("../../aliasConfig/pathAliases.config");
for (const [alias, target] of Object.entries(aliases)) {
  moduleAlias.addAlias(alias, path.join(__dirname, "..", "..", target));
}

const mongoose = require("mongoose");
const { Membership } = require("@models/Membership");
const { Organization } = require("@models/Organization");
const { MembershipRole } = require("@models/domainEnums");
const {
  withDefaultStaffPermissions,
} = require("@adminServices/organizations/permissionCatalogue");

const STAFF_ROLES = [MembershipRole.STAFF, MembershipRole.LINE_MANAGER];

const run = async () => {
  const uri = process.env.BASE_URL;
  if (!uri) throw new Error("MongoDB URI (BASE_URL) not found");

  await mongoose.connect(uri);

  const orgs = await Organization.find({})
    .select("_id moduleAccess")
    .lean();
  const orgById = new Map(orgs.map((org) => [String(org._id), org]));

  const memberships = await Membership.find({ role: { $in: STAFF_ROLES } })
    .select("_id organizationId role permissions")
    .lean();

  const ops = [];
  let unchanged = 0;
  let missingOrg = 0;

  for (const row of memberships) {
    const organization = orgById.get(String(row.organizationId));
    if (!organization) {
      missingOrg += 1;
      continue;
    }

    const current = Array.isArray(row.permissions) ? row.permissions : [];
    const next = withDefaultStaffPermissions(row.role, organization, current);
    const same =
      next.length === current.length && next.every((key) => current.includes(key));
    if (same) {
      unchanged += 1;
      continue;
    }

    ops.push({
      updateOne: {
        filter: { _id: row._id },
        update: { $set: { permissions: next } },
      },
    });
  }

  let modified = 0;
  const chunk = 500;
  for (let i = 0; i < ops.length; i += chunk) {
    const result = await Membership.bulkWrite(ops.slice(i, i + chunk));
    modified += result.modifiedCount || 0;
  }

  console.log(
    JSON.stringify(
      {
        scanned: memberships.length,
        updated: modified,
        queued: ops.length,
        alreadyHadDefaults: unchanged,
        missingOrg,
      },
      null,
      2
    )
  );

  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
