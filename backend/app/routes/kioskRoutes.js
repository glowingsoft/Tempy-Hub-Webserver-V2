const express = require("express");
const auth = require("@middlewares/authMiddleware");
const { requireMembership } = require("@middlewares/membershipMiddleware");
const createRateLimiter = require("@utils/rateLimiter");
const {
  requireKioskSession,
  requireKioskModule,
} = require("@middlewares/kioskMiddleware");
const { ModuleSlug } = require("@models/domainEnums");
const kioskController = require("../controllers/kioskController");
const kioskVisitController = require("../controllers/kioskVisitController");
const kioskEvacuationController = require("../controllers/kioskEvacuationController");

const router = express.Router();

const branchSearchLimiter = createRateLimiter("kiosk-branch-search", 15, 40);
const staffSearchLimiter = createRateLimiter("kiosk-staff-search", 15, 60);
const otpLimiter = createRateLimiter("kiosk-check-in-otp", 15, 20);
const emergencyPinLimiter = createRateLimiter("kiosk-emergency-pin", 15, 20);

router.get(
  "/branches/search",
  branchSearchLimiter,
  kioskController.searchBranches
);
router.post("/register", kioskController.register);
router.post("/session", kioskController.verifyAdminPin);

router.post(
  "/scan",
  auth,
  requireMembership(),
  kioskController.scanFromPhone
);
router.post("/contractor/scan", auth, kioskController.scanFromContractor);

// Fire drill / evacuation — gated on fireDrillEvacuation (Figma Screen 85–86).
router.get(
  "/evacuations/on-site-summary",
  requireKioskSession,
  requireKioskModule(ModuleSlug.FIRE_DRILL_EVACUATION),
  kioskEvacuationController.getOnSiteSummary
);
router.get(
  "/evacuations/active",
  requireKioskSession,
  requireKioskModule(ModuleSlug.FIRE_DRILL_EVACUATION),
  kioskEvacuationController.getActiveEvacuation
);
router.post(
  "/evacuations/emergency-pin",
  requireKioskSession,
  requireKioskModule(ModuleSlug.FIRE_DRILL_EVACUATION),
  emergencyPinLimiter,
  kioskEvacuationController.verifyEmergencyPin
);
router.post(
  "/evacuations",
  requireKioskSession,
  requireKioskModule(ModuleSlug.FIRE_DRILL_EVACUATION),
  kioskEvacuationController.startEvacuation
);
router.post(
  "/evacuations/close",
  requireKioskSession,
  requireKioskModule(ModuleSlug.FIRE_DRILL_EVACUATION),
  kioskEvacuationController.closeEvacuation
);

router.use(requireKioskSession, requireKioskModule(ModuleSlug.SIGN_IN_ATTENDANCE));

router.get("/me", kioskController.getMe);
router.get("/widgets", kioskController.listWidgets);
router.patch("/me", kioskController.updateMe);
router.get("/qr", kioskController.getQr);
router.get("/pairing/pending", kioskController.getPendingPairing);
router.post("/pairing/:sessionId/confirm", kioskController.confirmPairing);
router.post("/pairing/:sessionId/cancel", kioskController.cancelPairing);

router.get("/visits/categories", kioskVisitController.listCategories);
router.get("/visits/people/search", staffSearchLimiter, kioskVisitController.searchPeople);
router.get("/visits/policies", kioskVisitController.listPolicies);
router.get("/visits/on-site", staffSearchLimiter, kioskVisitController.listOnSite);
router.post("/visits/invite/verify", kioskVisitController.verifyInvite);
router.post("/visits/invite/resend", kioskVisitController.resendInvite);
router.post("/visits/check-in", kioskVisitController.checkIn);
router.post("/visits/check-out", kioskVisitController.checkOut);

router.get("/staff/search", staffSearchLimiter, kioskController.searchStaff);
router.get("/staff/:staffId/preview", kioskController.getStaffPreview);

router.post(
  "/attendance/otp/request",
  otpLimiter,
  kioskController.requestCheckInOtp
);
router.post("/attendance/otp/verify", otpLimiter, kioskController.verifyCheckInOtp);

router.post(
  "/attendance/verify",
  otpLimiter,
  kioskController.verifyStaffPin
);

router.get("/attendance/today", kioskController.getToday);
router.get(
  "/attendance/on-site",
  staffSearchLimiter,
  kioskController.listOnSite
);
router.post("/attendance/clock-in", kioskController.clockIn);
router.post("/attendance/clock-out", kioskController.clockOut);

module.exports = router;
