const express = require("express");
const router = express.Router();


const authRoutes = require("./authRoutes.js");



const uploadRoutes = require("./uploadRoutes.js");
const uploads3Routes = require("./uploadAWSRoutes.js");

router.use("/upload", uploadRoutes);
router.use("/upload/s3", uploads3Routes);

router.use("/auth", authRoutes);



module.exports = router;