const express = require("express");
const auth = require("@middlewares/authMiddleware");
const createRateLimiter = require("@utils/rateLimiter");
const {
  getNotifications,
  readNotification,
  readAllNotifications,
} = require("@controllersCommonModules/notificationsController");

const router = express.Router();
const notificationsRateLimiter = createRateLimiter("notifications", 10, 50);

router.get("/", notificationsRateLimiter, auth, getNotifications);
router.put("/read-all", notificationsRateLimiter, auth, readAllNotifications);
router.put("/:id/read", notificationsRateLimiter, auth, readNotification);

module.exports = router;
