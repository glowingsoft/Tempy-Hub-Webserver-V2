const sharp = require("sharp");
const { AppError } = require("@services/_errors/AppError");

const MAX_EDGE = 2048;
const MAX_BLUR_AREAS = 20;
const MAX_INPUT_PIXELS = 40_000_000;

/** Re-encodes the upload, which also proves it is a real image, and keeps its longest edge within MAX_EDGE. */
const prepareUpload = async (buffer) => {
  try {
    const { data, info } = await sharp(buffer, {
      limitInputPixels: MAX_INPUT_PIXELS,
    })
      .rotate()
      .resize(MAX_EDGE, MAX_EDGE, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    return {
      buffer: data,
      width: info.width,
      height: info.height,
      size: info.size,
      mimeType: "image/jpeg",
    };
  } catch {
    throw new AppError("invalid_image", 400);
  }
};

const isFraction = (value) =>
  typeof value === "number" && Number.isFinite(value);

/** Areas are fractions of the image (0 to 1), so the app does not need to know the stored size. */
const validateAreas = (areas) => {
  const valid =
    Array.isArray(areas) &&
    areas.length > 0 &&
    areas.length <= MAX_BLUR_AREAS &&
    areas.every(
      (a) =>
        a &&
        [a.x, a.y, a.width, a.height].every(isFraction) &&
        a.x >= 0 &&
        a.y >= 0 &&
        a.width > 0 &&
        a.height > 0 &&
        a.x + a.width <= 1 &&
        a.y + a.height <= 1,
    );
  if (!valid) throw new AppError("invalid_blur_areas", 400);
  return areas;
};

const blurAreas = async (buffer, areas) => {
  validateAreas(areas);

  const base = sharp(buffer);
  const { width, height } = await base.metadata();

  const patches = await Promise.all(
    areas.map(async (area) => {
      const left = Math.min(width - 1, Math.max(0, Math.round(area.x * width)));
      const top = Math.min(
        height - 1,
        Math.max(0, Math.round(area.y * height)),
      );
      const patchWidth = Math.max(
        1,
        Math.min(width - left, Math.round(area.width * width)),
      );
      const patchHeight = Math.max(
        1,
        Math.min(height - top, Math.round(area.height * height)),
      );
      const sigma = Math.max(20, Math.min(patchWidth, patchHeight) / 4);

      const input = await sharp(buffer)
        .extract({ left, top, width: patchWidth, height: patchHeight })
        .blur(sigma)
        .toBuffer();
      return { input, left, top };
    }),
  );

  const out = await base.composite(patches).jpeg({ quality: 82 }).toBuffer();
  return { buffer: out, mimeType: "image/jpeg" };
};

module.exports = { prepareUpload, blurAreas, validateAreas };
