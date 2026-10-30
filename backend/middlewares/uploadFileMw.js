const multer = require("multer");
const path = require("path");

// Set storage engine
const storage = multer.diskStorage({
  destination: "./uploads/", // Specify the destination folder
  filename: (req, file, cb) => {
    cb(
      null,
      file.fieldname + "-" + Date.now() + path.extname(file.originalname),
    );
  },
});

// Initialize upload
const upload = multer({
  storage: storage,
  limits: { fileSize: 3000000 }, // Limit file size to 3MB
  fileFilter: (req, file, cb) => {
    checkFileType(file, cb);
  },
}).single("file");

// Check file type
function checkFileType(file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedExt = /\.(jpe?g|png|gif|bmp|tiff|webp|pdf)$/;
  const allowedMime =
    /^(image\/(jpeg|jpg|png|gif|bmp|tiff|webp)|application\/pdf)$/i;

  if (allowedExt.test(ext) && allowedMime.test(file.mimetype)) {
    return cb(null, true);
  }
  cb(new Error("Invalid file type. Only images and PDF are allowed."));
}

module.exports = upload;
