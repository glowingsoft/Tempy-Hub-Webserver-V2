
function s3BaseUrl() {
  const base = process.env.S3_BASE_URL || "";
  if (!base) return "";
  return base.endsWith("/") ? base : `${base}/`;
}

function getFullImageUrl(imagePath, baseUrl = s3BaseUrl()) {
  const trimmed = imagePath == null ? "" : String(imagePath).trim();
  if (trimmed && !trimmed.startsWith("http")) {
    return baseUrl + trimmed;
  }
  return trimmed || `${baseUrl}noimage.png`;
}

function toPublicImageUrl(value) {
  const trimmed = value == null ? "" : String(value).trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return getFullImageUrl(trimmed);
}

module.exports = { getFullImageUrl, toPublicImageUrl };
