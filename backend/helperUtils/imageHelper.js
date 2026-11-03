
function getFullImageUrl(imagePath, baseUrl = process.env.S3_BASE_URL || "") {
  if (imagePath && !imagePath.startsWith("http")) {
    return baseUrl + imagePath;
  }
  return imagePath || baseUrl + "noimage.png";
}

function toPublicImageUrl(value) {
  const trimmed = value == null ? "" : String(value).trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return getFullImageUrl(trimmed);
}

module.exports = { getFullImageUrl, toPublicImageUrl };
