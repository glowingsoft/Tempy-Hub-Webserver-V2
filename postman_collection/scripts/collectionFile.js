const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "..");

const collectionFile = () => {
  const files = fs
    .readdirSync(DIR)
    .filter(
      (name) =>
        name.endsWith(".postman_collection.json") && !/copy/i.test(name)
    );
  const latest = files.find((name) => /latest/i.test(name));
  const name = latest || files[0];
  if (!name) {
    throw new Error("Postman collection not found");
  }
  return path.join(DIR, name);
};

module.exports = { collectionFile };
