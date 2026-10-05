const express = require("express");
const auth = require("@middlewares/authMiddleware");
const { requireMembership, requireModule } = require("@middlewares/membershipMiddleware");
const { ModuleSlug } = require("@models/domainEnums");
const leaveController = require("../controllers/leaveController");

const router = express.Router();

router.use(
  auth,
  requireMembership(),
  requireModule(ModuleSlug.LEAVE)
);

router.get("/entitlements", leaveController.listMyEntitlements);
router.get("/", leaveController.listMyLeaveRequests);
router.post("/", leaveController.createLeaveRequest);
router.get("/:requestId", leaveController.getMyLeaveRequest);
router.post("/:requestId/cancel", leaveController.cancelLeaveRequest);

module.exports = router;
