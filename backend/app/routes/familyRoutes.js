const express = require("express");
const auth = require("@middlewares/authMiddleware");
const { requireAudience } = require("@middlewares/audienceMiddleware");
const { AuthAudience } = require("@models/domainEnums");
const familyController = require("../controllers/familyController");

const router = express.Router();

router.use(auth, requireAudience([AuthAudience.FAMILY]));

// Usable before the member has an active link, so the Join A Family screen works.
router.get("/relationships", familyController.listRelationships);
router.get("/residents", familyController.listMyResidents);

module.exports = router;
