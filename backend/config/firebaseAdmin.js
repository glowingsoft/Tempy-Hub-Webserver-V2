const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getMessaging } = require("firebase-admin/messaging");
const fs = require("fs");
const path = require("path");

const folderPath = path.join(__dirname, "../secretAssets");
const SAMPLE_MARKER = "SERVICE_ACCOUNT_PLACEHOLDER";
const candidateFiles = ["key.json", "serviceAccountKey.json"];

if (!fs.existsSync(folderPath)) {
  fs.mkdirSync(folderPath, { recursive: true });
}

const loadServiceAccount = () => {
  for (const name of candidateFiles) {
    const filePath = path.join(folderPath, name);
    if (!fs.existsSync(filePath)) continue;

    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return { filePath, serviceAccount: parsed };
    } catch (error) {
      console.warn(
        `Firebase Admin skipped — ${name} is not valid JSON (${error.message}).`
      );
      return { filePath, serviceAccount: null };
    }
  }

  const fallbackPath = path.join(folderPath, "serviceAccountKey.json");
  fs.writeFileSync(
    fallbackPath,
    JSON.stringify({ sample: SAMPLE_MARKER }, null, 2)
  );
  return { filePath: fallbackPath, serviceAccount: { sample: SAMPLE_MARKER } };
};

const { filePath, serviceAccount } = loadServiceAccount();

const isRealServiceAccount =
  serviceAccount &&
  serviceAccount.sample !== SAMPLE_MARKER &&
  typeof serviceAccount.private_key === "string" &&
  typeof serviceAccount.client_email === "string";

if (isRealServiceAccount && getApps().length === 0) {
  initializeApp({
    credential: cert(serviceAccount),
  });
  console.log("Firebase Admin initialized");
} else if (!isRealServiceAccount) {
  console.warn(
    `Firebase Admin skipped — put a Firebase service account JSON at ${filePath} (Project settings → Service accounts → Generate new private key).`
  );
}

module.exports = {
  messaging: () => getMessaging(),
};
