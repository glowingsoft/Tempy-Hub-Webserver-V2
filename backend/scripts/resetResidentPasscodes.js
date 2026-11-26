/**
 * One-off: give every older resident a new random 5-digit security passcode, because only
 * the hash of the old one was saved and it cannot be shown. All organizations and branches.
 *
 * THE OLD PASSCODES STOP WORKING. Residents without a passcode, or whose passcode can
 * already be shown, are skipped. Passcodes are never printed.
 *
 *   node backend/scripts/resetResidentPasscodes.js                       preview, saves nothing
 *   node backend/scripts/resetResidentPasscodes.js --apply --db=<name>   saves; name must match
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

const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const { Resident } = require("@models/Resident");
const {
  encryptPasscode,
} = require("@adminServices/residents/residentPasscodeCrypto");

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const confirmedDb = args.find((arg) => arg.startsWith("--db="))?.slice(5);

const randomPasscode = () =>
  String(crypto.randomInt(0, 100000)).padStart(5, "0");

const run = async () => {
  const uri = process.env.BASE_URL;
  if (!uri) throw new Error("MongoDB URI (BASE_URL) not found");
  if (!process.env.RESIDENT_PASSCODE_SECRET) {
    throw new Error("Set RESIDENT_PASSCODE_SECRET in .env first");
  }

  await mongoose.connect(uri, { autoIndex: false, autoCreate: false });
  const { host, name } = mongoose.connection;
  console.log(`Database: ${name} on ${host}`);

  if (apply && confirmedDb !== name) {
    throw new Error(`Nothing saved. To confirm, add --db=${name}`);
  }

  const residents = await Resident.find({
    visitorPasscodeHash: { $nin: [null, ""] },
    visitorPasscodeEncrypted: { $in: [null, ""] },
  })
    .select("_id name organizationId +visitorPasscodeHash")
    .lean();

  if (!apply) {
    residents.forEach((row) =>
      console.log(`${row.organizationId}  ${row._id}  ${row.name}`),
    );
    console.log(`Preview: ${residents.length} would be reset. Nothing saved.`);
    return;
  }

  let updated = 0;
  for (const row of residents) {
    const passcode = randomPasscode();
    // The old hash is in the filter, so a passcode changed meanwhile is left alone.
    const result = await Resident.updateOne(
      { _id: row._id, visitorPasscodeHash: row.visitorPasscodeHash },
      {
        $set: {
          visitorPasscodeHash: await bcrypt.hash(passcode, 10),
          visitorPasscodeEncrypted: encryptPasscode(passcode),
          visitorPasscodeRequired: true,
          visitorPasscodeSetAt: new Date(),
        },
      },
    );
    updated += result.modifiedCount || 0;
  }
  console.log(
    `Reset ${updated} of ${residents.length}; ${residents.length - updated} skipped (changed meanwhile).`,
  );
};

run()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect().catch(() => {}));
