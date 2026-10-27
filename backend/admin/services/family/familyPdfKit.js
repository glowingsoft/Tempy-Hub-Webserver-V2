const sharp = require("sharp");
const fontkit = require("fontkit");

/** What the family PDFs (newsletter and gazette) share: A4, the brand colours, embedded fonts and photo handling. */
const PAGE = { width: 595.28, height: 841.89 };

const COLORS = {
  navy: "#1f3a5f",
  ink: "#1a1a1a",
  muted: "#555555",
  soft: "#f1f3f7",
  line: "#d9dde4",
  accent: "#c8553d",
  placeholder: "#dfe5ec",
  cream: "#f0ede6",
};

const PHOTO_WIDTH = 900;
const PHOTO_QUALITY = 80;

/**
 * Arimo and Tinos are the fonts the templates are set in (the same letter shapes and widths as Arial and
 * Times New Roman), embedded so every viewer and printer shows the same pages. The files cover Latin
 * (including Polish, Czech, Welsh and Vietnamese), Greek, Cyrillic and Hebrew letters.
 */
const FONT_FILES = {
  Sans: "@expo-google-fonts/arimo/400Regular/Arimo_400Regular.ttf",
  "Sans-Bold": "@expo-google-fonts/arimo/700Bold/Arimo_700Bold.ttf",
  "Serif-Bold": "@expo-google-fonts/tinos/700Bold/Tinos_700Bold.ttf",
};

const fonts = new Map();
const fontOf = (style) => {
  if (!fonts.has(style)) fonts.set(style, fontkit.openSync(require.resolve(FONT_FILES[style])));
  return fonts.get(style);
};

const isLetter = (char) => !/\s/u.test(char);

/** A letter the font does not have (an emoji, Arabic or Chinese) is shown as ? instead of an empty box. */
const showable = (style, value) => {
  const font = fontOf(style);
  return [...String(value ?? "")].map((char) => (isLetter(char) && !font.hasGlyphForCodePoint(char.codePointAt(0)) ? "?" : char)).join("");
};

const registerFonts = (doc) => {
  Object.entries(FONT_FILES).forEach(([style, file]) => doc.registerFont(style, require.resolve(file)));

  let style = "Sans";
  const setFont = doc.font.bind(doc);
  const drawText = doc.text.bind(doc);
  const measure = doc.heightOfString.bind(doc);

  doc.font = (name, ...rest) => {
    if (FONT_FILES[name]) style = name;
    return setFont(name, ...rest);
  };
  doc.text = (value, ...rest) => drawText(showable(style, value), ...rest);
  doc.heightOfString = (value, ...rest) => measure(showable(style, value), ...rest);
  setFont(style);
};

/** Line endings are made uniform and control characters dropped. */
const printable = (value) =>
  String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");

/** Photos come from our own storage; a photo that cannot be read leaves a plain box rather than a failed PDF. */
const prepareImage = async (buffer) => {
  try {
    return await sharp(buffer, { limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width: PHOTO_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: PHOTO_QUALITY })
      .toBuffer();
  } catch (error) {
    return null;
  }
};

/** The text cut to fit a number of lines, ending in an ellipsis when it had to be shortened. */
const fitText = (doc, text, width, maxLines, size) => {
  doc.fontSize(size);
  const lineHeight = doc.currentLineHeight(true);
  const maxHeight = lineHeight * maxLines;
  if (doc.heightOfString(text, { width }) <= maxHeight) return text;

  let cut = text;
  while (cut.length > 1 && doc.heightOfString(`${cut}…`, { width }) > maxHeight) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
};

/** A photo cropped to fill its box with rounded corners; a plain box when the photo could not be read. */
const drawPhoto = (doc, image, x, y, { width, height }, radius = 8) => {
  doc.save();
  doc.roundedRect(x, y, width, height, radius).clip();
  if (image) {
    doc.image(image, x, y, { cover: [width, height], align: "center", valign: "center" });
  } else {
    doc.rect(x, y, width, height).fill(COLORS.placeholder);
  }
  doc.restore();
};

module.exports = { PAGE, COLORS, registerFonts, printable, prepareImage, fitText, drawPhoto };
