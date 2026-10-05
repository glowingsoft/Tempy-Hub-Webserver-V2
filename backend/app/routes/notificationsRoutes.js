const express = require("express");
const auth = require("../../middlewares/authMiddleware");
const createRateLimiter = require("../../helperUtils/rateLimiter");

const {
    getNotifications,
    readNotification,
} = require("../controllers/notificationsController");

const router = express.Router();
const notificationsRateLimiter = createRateLimiter("notifications", 10, 50);

// Route to get all notifications with pagination
router.get("/", notificationsRateLimiter, auth, getNotifications);

// Route to mark a notification as read by ID
router.put("/:id/read", notificationsRateLimiter, auth, readNotification);

module.exports = router;
