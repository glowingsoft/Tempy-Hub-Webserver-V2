const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const collectionPath = path.join(root, "TempyHubAPI.postman_collection.json");
const envPath = path.join(root, "TempyHubAPI.postman_environment.json");

function readJson(file) {
  const raw = fs.readFileSync(file, "utf8");
  return JSON.parse(raw);
}

if (fs.existsSync(envPath)) {
  throw new Error(
    "Remove TempyHubAPI.postman_environment.json — use collection variables only"
  );
}

const collection = readJson(collectionPath);

if (!collection.info || collection.info.name !== "Tempy Hub API") {
  throw new Error("Collection info.name must be 'Tempy Hub API'");
}
if (!Array.isArray(collection.item) || collection.item.length === 0) {
  throw new Error("Collection has no folders/requests");
}

const requiredFolders = ["App", "Admin Panel"];
const topNames = collection.item.map((i) => i.name);
for (const name of requiredFolders) {
  if (!topNames.includes(name)) {
    throw new Error(`Missing top-level folder: ${name}`);
  }
}

const vars = collection.variable || [];
const varKeys = new Set(vars.map((v) => v.key));
for (const key of [
  "url",
  "token",
  "email",
  "password",
  "adminEmail",
  "adminPassword",
]) {
  if (!varKeys.has(key)) {
    throw new Error(`Collection missing variable: ${key}`);
  }
}

const urlVar = vars.find((v) => v.key === "url");
if (!urlVar || !String(urlVar.value).includes("localhost:6060")) {
  throw new Error("Collection url variable must point at localhost:6060");
}

const raw = fs.readFileSync(collectionPath, "utf8");
if (raw.includes("pm.environment.set")) {
  throw new Error(
    "Use pm.collectionVariables.set (not pm.environment.set) in test scripts"
  );
}

console.log("postman collection OK (collection variables only)");
