// helperUtils/server-setup.js
const mongoose = require("mongoose");
const runDBBootstrap = require("../config/startupSetup/db.bootstrap");

let bootstrapTriggered = false; // 🔒 in-process guard

const connectToDB = async (retries = 5, delay = 3000) => {
  const uri = process.env.BASE_URL;
  if (!uri) throw new Error("MongoDB URI not found");

  /**
   * Register ONCE (outside retry loop)
   */
  mongoose.connection.once("open", async () => {
    if (bootstrapTriggered) return;

    bootstrapTriggered = true;

    try {
      logger.info("MongoDB connection opened — running bootstrap");
      await runDBBootstrap();
    } catch (err) {
      logger.fatal("DB bootstrap failed", { error: err });
      // ❗ Do NOT exit — let app continue
    }
  });

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await mongoose.connect(uri, {
        maxPoolSize: 10,
        minPoolSize: 2,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
      });

      logger.info("MongoDB connected", {
        attempt,
        host: mongoose.connection.host,
      });

      return;
    } catch (err) {
      logger.error("MongoDB connection failed", {
        attempt,
        error: err.message,
      });

      if (attempt === retries) {
        logger.fatal("MongoDB connection failed after retries", {
          uri: uri.replace(/\/\/.*@/, "//***@"),
        });
        return;
      }

      await new Promise((r) => setTimeout(r, delay));
    }
  }
};

module.exports = connectToDB;
