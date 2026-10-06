const express = require("express");
const { getHome } = require("../controllers/homeController");
const auth = require("@middlewares/authMiddleware");
const { requireMembership } = require("@middlewares/membershipMiddleware");

const router = express.Router();
router.use(auth, requireMembership());

router.get("/", getHome);

module.exports = router;
