/** The S3 key inside a stored file's URL, or "" when the URL is not one of this bucket's. */
const keyFromUrl = (url, { bucket } = {}) => {
  if (typeof url !== "string" || !url || !bucket) return "";
  try {
    const { hostname, pathname } = new URL(url);
    if (!hostname.startsWith(`${bucket}.s3.`)) return "";
    return decodeURIComponent(pathname.replace(/^\/+/, ""));
  } catch {
    return "";
  }
};

module.exports = { keyFromUrl };
