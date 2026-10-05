const express = require("express");
const auth = require("@middlewares/authMiddleware");

const {
  allUsers,
  blockUser,
  reportUser,
  addOrUpdateSubscription,
  removeSubscription,
  getSubscriptions,
  getUserProfile,
  updateUserProfile,
  getOtherUserProfile,
} = require("../controllers/userController");
const roleMiddleware = require("@middlewares/roleMiddleware");
const router = express.Router();

// Apply auth middleware to the router
router.use(auth);

// // Specify the fields you want to populate dynamically
// const fieldsToPopulate = [
//   "profileIcon",
//   "age",
// ];

router.get("/profile", (req, res, next) => {
  getUserProfile(req, res, next);
});

router.get("/profile/:userId", (req, res, next) => {
  getOtherUserProfile(req, res, next);
});

router.put("/profile", updateUserProfile)
router.get("/allUsers", roleMiddleware(["admin"]), allUsers);
router.post("/:userIdToBlock/block", blockUser);
router.post("/:userIdToReport/report", reportUser);
router.post("/add-update-subscription", addOrUpdateSubscription);
router.post("/remove-subscription/:subscriptionId", removeSubscription);
router.get("/subscriptions", getSubscriptions);

module.exports = router;
