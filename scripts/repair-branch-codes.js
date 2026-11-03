require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const path = require("path");
const crypto = require("crypto");
const moduleAlias = require("module-alias");
const aliases = require("../aliasConfig/pathAliases.config");
for (const [alias, target] of Object.entries(aliases)) {
  moduleAlias.addAlias(alias, path.join(__dirname, "..", target));
}
require("module-alias/register");

const mongoose = require("mongoose");
const { Branch } = require("@models/Branch");

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS = "0123456789";
const ALL = `${LETTERS}${DIGITS}`;
const VALID = /^[A-Z0-9]{6}$/;

const pick = (set) => set[crypto.randomInt(set.length)];

const randomCode = () => {
  const chars = [pick(LETTERS), pick(DIGITS), pick(ALL), pick(ALL), pick(ALL), pick(ALL)];
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
};

const nextUnique = (used) => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const code = randomCode();
    if (!used.has(code)) {
      used.add(code);
      return code;
    }
  }
  throw new Error("Could not generate a unique branch code");
};

const needsNewCode = (code) => {
  const value = String(code || "").toUpperCase();
  return !VALID.test(value) || !/[A-Z]/.test(value) || !/[0-9]/.test(value);
};

(async () => {
  await mongoose.connect(process.env.BASE_URL);

  const branches = await Branch.find().select("_id name code").lean();
  const used = new Set(
    branches
      .map((row) => String(row.code || "").toUpperCase())
      .filter((code) => !needsNewCode(code))
  );

  const writes = [];
  for (const branch of branches) {
    if (!needsNewCode(branch.code)) continue;
    const code = nextUnique(used);
    writes.push({
      updateOne: {
        filter: { _id: branch._id },
        update: { $set: { code } },
      },
    });
    console.log(`${branch.name}: ${branch.code} -> ${code}`);
  }

  if (writes.length) await Branch.bulkWrite(writes);
  console.log("updated", writes.length, "of", branches.length);

  await mongoose.disconnect();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
