require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const path = require("path");
const moduleAlias = require("module-alias");
const aliases = require("../aliasConfig/pathAliases.config");
for (const [alias, target] of Object.entries(aliases)) {
  moduleAlias.addAlias(alias, path.join(__dirname, "..", target));
}
require("module-alias/register");

const mongoose = require("mongoose");
const { FamilyCode } = require("@models/FamilyCode");
const { hashCode, encryptCode } = require("@appServices/family/familyCodeCrypto");

/**
 * Family codes used to be stored as typed. This hashes and encrypts every one that still is,
 * removes the typed copy, and replaces the old unique index on `code` (which would reject a
 * second code without that field). Safe to run again.
 */
(async () => {
  await mongoose.connect(process.env.BASE_URL);

  try {
    await FamilyCode.collection.dropIndex("code_1");
    console.log("dropped code_1");
  } catch (e) {
    console.log("drop code_1:", e.codeName || e.message);
  }

  const legacy = await FamilyCode.collection.find({ code: { $exists: true }, codeHash: { $exists: false } }).toArray();
  for (const doc of legacy) {
    await FamilyCode.collection.updateOne(
      { _id: doc._id },
      { $set: { codeHash: hashCode(doc.code), codeCipher: encryptCode(doc.code) }, $unset: { code: "" } }
    );
  }
  console.log(`converted ${legacy.length} code(s)`);

  const leftover = await FamilyCode.collection.countDocuments({ code: { $exists: true } });
  if (leftover) console.log(`WARNING: ${leftover} code(s) still hold a typed code`);

  await FamilyCode.syncIndexes();
  console.log("indexes synced");

  await mongoose.disconnect();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
