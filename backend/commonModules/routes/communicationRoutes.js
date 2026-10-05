// communicationRoutes.js
const express = require('express');
const auth = require('@middlewares/authMiddleware');
const {
  // sendEmailMailgun,
  sendNotificationControllerForTesting,
} = require('../controllers/communicationController');

const router = express.Router();

// Route to send email
// router.post('/send-email-mailgun', auth, sendEmailMailgun);

// Route to send notification
router.post('/send-notification', auth, sendNotificationControllerForTesting);

module.exports = router;
