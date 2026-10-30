const express = require("express");
const router = express.Router();


const authRoutes = require("./authRoutes.js");



const uploadRoutes = require("./uploadRoutes.js");
const uploads3Routes = require("./uploadAWSRoutes.js");
const chatRoutes = require("../chatModule/routes/messageRoutes");
const notificationsRoutes = require("./notificationsRoutes");

router.use("/upload", uploadRoutes);
router.use("/upload/s3", uploads3Routes);

router.use("/auth", authRoutes);
router.use("/chats", chatRoutes);
router.use("/notifications", notificationsRoutes);



module.exports = router;