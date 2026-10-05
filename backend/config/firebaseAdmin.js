const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

const folderPath = path.join(__dirname, "../secretAssets");
const filePath = path.join(folderPath, "serviceAccountKey.json");

// Ensure folder exists
if (!fs.existsSync(folderPath)) {
  fs.mkdirSync(folderPath, { recursive: true });
}

// Ensure file exists and write sample if missing
if (!fs.existsSync(filePath)) {
  fs.writeFileSync(
    filePath,
    JSON.stringify({ sample: "SERVICE_ACCOUNT_PLACEHOLDER" }, null, 2)
  );
}

const serviceAccount = require("../secretAssets/serviceAccountKey.json");

// STATIC value to detect placeholder
const SAMPLE_MARKER = "SERVICE_ACCOUNT_PLACEHOLDER";

if (serviceAccount.sample === SAMPLE_MARKER) {
  console.warn("Firebase Admin skipped — service account is sample at ../secretAssets/serviceAccountKey.json.");
} else {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  console.log("Firebase Admin initialized");
}

module.exports = admin;
