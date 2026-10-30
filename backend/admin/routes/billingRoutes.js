const express = require("express");
const auth = require("@middlewares/authMiddleware");
const { requireMembership } = require("@middlewares/membershipMiddleware");
const createRateLimiter = require("@utils/rateLimiter");
const billingController = require("../controllers/billingController");

const router = express.Router();

const readLimiter = createRateLimiter("billing-reads", 10, 120);
const writeLimiter = createRateLimiter("billing-writes", 10, 30);
const recalculateLimiter = createRateLimiter("billing-recalculations", 15, 10);

/** A platform admin works above any organization; everyone else needs the x-org-id header and a membership in it. */
const billingAccess = (req, res, next) =>
  req.user?.userType === "admin" ? next() : requireMembership()(req, res, next);

router.use(auth, billingAccess);

router.get("/usage", readLimiter, billingController.listUsage);
router.put(
  "/organizations/:organizationId",
  writeLimiter,
  billingController.updatePlan,
);
router.post(
  "/organizations/:organizationId/recalculate",
  recalculateLimiter,
  billingController.recalculate,
);
router.put("/settings", writeLimiter, billingController.updatePrices);

module.exports = router;
