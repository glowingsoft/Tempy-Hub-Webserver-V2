const express = require("express");
const auth = require("@middlewares/authMiddleware");
const { requireMembership } = require("@middlewares/membershipMiddleware");
const createRateLimiter = require("@utils/rateLimiter");
const billingController = require("../controllers/billingController");

const router = express.Router();

const readLimiter = createRateLimiter("billing-reads", 10, 120);

/** A platform admin works above any organization; everyone else needs the x-org-id header and a membership in it. */
const billingAccess = (req, res, next) =>
  req.user?.userType === "admin" ? next() : requireMembership()(req, res, next);

router.use(auth, billingAccess);

router.get("/usage", readLimiter, billingController.listUsage);
router.get("/usage/:organizationId", readLimiter, billingController.getUsageDetail);

module.exports = router;
