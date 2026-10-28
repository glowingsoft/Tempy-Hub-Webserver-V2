const express = require("express");
const auth = require("../../middlewares/authMiddleware");

const {
  login,
  me,
  generateOtp,
  resetPassword,
  changePassword,
  verifyOtp,
  logout,
  deleteAccount,
  previewInvitation,
  acceptInvitation,
  previewFamilyInvitation,
  acceptFamilyInvitation,
} = require("../controllers/authController");
const createRateLimiter = require("@utils/rateLimiter");

const router = express.Router();
// Create a rate limiter for signup routes
// Define rate limiters
const loginRateLimiter = createRateLimiter("login", 15, 15); // 15 requests per 15 minute
const generateOtpRateLimiter = createRateLimiter("forgotPassword", 15, 15); // 15 requests per 15 minutes
const resendOtpRateLimiter = createRateLimiter("resendOtp", 15, 15); // 15 requests per 15 minutes
const verifyOtpRateLimiter = createRateLimiter("verifyOtp", 15, 15); // 10 requests per 10 minutes

const resetPasswordRateLimiter = createRateLimiter("resetPassword", 15, 15); // 15 requests per 15 minutes

// No public self-registration in this phase: accounts are created by an admin
// through the admin panel, so POST /register is intentionally not mounted.
router.post("/login", loginRateLimiter, login);
router.get("/me", auth, me);
router.post("/forgot-password", generateOtpRateLimiter, (req, res, next) => {
  req.body.type = "email";
  generateOtp(req, res, next);
});
router.post("/resend-otp/email", resendOtpRateLimiter, (req, res, next) => {
  req.body.type = "email";
  generateOtp(req, res, next);
});
router.post("/resend-otp/phone", resendOtpRateLimiter, (req, res, next) => {
  req.body.type = "phoneNumber";
  generateOtp(req, res, next);
});
router.post("/verify-otp/email", verifyOtpRateLimiter, (req, res, next) => {
  req.body.type = "email";
  verifyOtp(req, res, next);
});
router.post("/verify-otp/phone", verifyOtpRateLimiter, (req, res, next) => {
  req.body.type = "phoneNumber";
  verifyOtp(req, res, next);
});
router.post("/reset-password", resetPasswordRateLimiter, resetPassword);
router.post(
  "/change-password",
  auth,
  resetPasswordRateLimiter,
  changePassword
);

// Token-gated, not self-registration: an admin issued the invitation. Rate
// limited because the token is guessable in principle.
const invitationRateLimiter = createRateLimiter("invitation", 15, 15);
router.get("/invitations/:token", invitationRateLimiter, previewInvitation);
router.post("/invitations/:token/accept", invitationRateLimiter, acceptInvitation);

// Same token-gated pattern for relatives invited by a care home to see a resident.
router.get(
  "/family-invitations/:token",
  invitationRateLimiter,
  previewFamilyInvitation
);
router.post(
  "/family-invitations/:token/accept",
  invitationRateLimiter,
  acceptFamilyInvitation
);

router.post("/logout", auth, logout);
router.delete("/delete-account", auth, deleteAccount);
// Social auth also provisions accounts on first use, so it stays unmounted
// alongside /register until self-service signup is in scope.

module.exports = router;
