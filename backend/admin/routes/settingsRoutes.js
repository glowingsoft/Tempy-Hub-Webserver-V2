const express = require("express");
const {
  getTermsAndConditions,
  getAboutUs,
  getPrivacyPolicy,
  updateAdminSettings,
  createAdminSettings,
  getFaqs
} = require("../../commonModules/controllers/settingsController");
const {
  createFaq,
  updateFaq,
  deleteFaq,
} = require("../controllers/adminPanelController");
const auth = require("@middlewares/authMiddleware");
const createRateLimiter = require("@utils/rateLimiter");
const roleMiddleware = require("@middlewares/roleMiddleware");

const router = express.Router();

// Create a rate limiter for Admin Settings
const apiRateLimiter = createRateLimiter("AdminSettings");

// Route to fetch terms and conditions with rate limiting
router.get("/terms-conditions", apiRateLimiter, getTermsAndConditions);

// Route to fetch about us with rate limiting
router.get("/about-us", apiRateLimiter, getAboutUs);

// Route to fetch privacy policy with rate limiting
router.get("/privacy-policy", apiRateLimiter, getPrivacyPolicy);

// Route to fetch privacy policy with rate limiting
router.get("/faqs", apiRateLimiter, getFaqs);
router.post("/faqs", auth, roleMiddleware(["admin"]), createFaq);
router.put("/faqs/:id", auth, roleMiddleware(["admin"]), updateFaq);
router.delete("/faqs/:id", auth, roleMiddleware(["admin"]), deleteFaq);

// Route to create admin settings (requires auth and admin privileges)
router.post("/create", auth, roleMiddleware(["admin"]), createAdminSettings);

// Route to update all settings at once (requires auth and admin privileges)
router.put("/update/:id", auth, roleMiddleware(["admin"]), updateAdminSettings);

module.exports = router;
