const express = require("express");
const auth = require("@middlewares/authMiddleware");
const { requireAudience } = require("@middlewares/audienceMiddleware");
const { requireResidentAccess } = require("@middlewares/residentMiddleware");
const { AuthAudience } = require("@models/domainEnums");
const controller = require("../controllers/residentAppController");

const router = express.Router();

router.use(
  auth,
  requireAudience([AuthAudience.RESIDENT]),
  requireResidentAccess,
);

router.get("/family", controller.getFamilyScreen);
router.get("/photos", controller.getPhotosScreen);
router.get("/photos/:mediaId", controller.getPhotoScreen);
router.get("/gazette", controller.getGazetteScreen);
router.get("/gazettes", controller.listGazettes);
router.get("/gazettes/:gazetteId", controller.getGazette);
router.get("/visitors", controller.getVisitorsScreen);

module.exports = router;
