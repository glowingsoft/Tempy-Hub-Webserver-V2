const fs = require("fs");
const path = require("path");
const ejs = require("ejs");
const sharp = require("sharp");
const fontkit = require("fontkit");

/** What the family PDFs (newsletter and gazette) share: the brand colours, embedded fonts, photo handling and templates. */
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
const TEMPLATE_DIR = path.join(__dirname, "../../../assets/pdf/family");

/**
 * Arimo and Tinos are the fonts the templates are set in (the same letter shapes and widths as Arial and
 * Times New Roman), embedded so every viewer and printer shows the same pages. The files cover Latin
 * (including Polish, Czech, Welsh and Vietnamese), Greek, Cyrillic and Hebrew letters.
 */
const FONT_FILES = {
  Sans: {
    family: "Arimo",
    weight: 400,
    file: "@expo-google-fonts/arimo/400Regular/Arimo_400Regular.ttf",
  },
  "Sans-Bold": {
    family: "Arimo",
    weight: 700,
    file: "@expo-google-fonts/arimo/700Bold/Arimo_700Bold.ttf",
  },
  "Serif-Bold": {
    family: "Tinos",
    weight: 700,
    file: "@expo-google-fonts/tinos/700Bold/Tinos_700Bold.ttf",
  },
};

const fonts = new Map();
const fontOf = (style) => {
  if (!fonts.has(style))
    fonts.set(style, fontkit.openSync(require.resolve(FONT_FILES[style].file)));
  return fonts.get(style);
};

// Fonts travel inside the page as data, so the renderer never needs to load anything from disk or the network.
let cachedFontCss;
const fontCss = () => {
  if (!cachedFontCss) {
    cachedFontCss = Object.values(FONT_FILES)
      .map(({ family, weight, file }) => {
        const data = fs.readFileSync(require.resolve(file)).toString("base64");
        return `@font-face { font-family: "${family}"; font-weight: ${weight}; src: url(data:font/ttf;base64,${data}) format("truetype"); }`;
      })
      .join("\n");
  }
  return cachedFontCss;
};

const printable = (value) =>
  String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");

/** A letter the font does not have (an emoji, Arabic or Chinese) is shown as ? instead of an empty box. */
const showable = (style, value) => {
  const font = fontOf(style);
  return [...printable(value)]
    .map((char) =>
      /\s/u.test(char) || font.hasGlyphForCodePoint(char.codePointAt(0))
        ? char
        : "?",
    )
    .join("");
};

/** The largest font size, from max down to min, at which the text fits one line of the given width in points. */
const fitFontSize = ({ style, text, width, max, min }) => {
  const font = fontOf(style);
  const unitsWide =
    font.layout(showable(style, text)).advanceWidth / font.unitsPerEm;
  return Math.max(min, Math.min(max, Math.floor(width / (unitsWide || 1))));
};

/** A value placed inside a CSS string in a stylesheet: quotes, backslashes, line breaks and "<" cannot break out of it. */
const cssString = (value) =>
  `"${String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\\"]/g, "\\$&")
    .replace(/</g, "\\3c ")}"`;

// A photo that cannot be read leaves a plain box rather than a failed PDF.
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

const photoUris = async (photos) => {
  const uris = new Map();
  await Promise.all(
    [...photos.entries()].map(async ([id, bytes]) => {
      const image = await prepareImage(bytes);
      uris.set(
        String(id),
        image ? `data:image/jpeg;base64,${image.toString("base64")}` : null,
      );
    }),
  );
  return uris;
};

const templates = new Map();
/** Fills a template from assets/pdf/family. Everything printed with <%= %> is HTML-escaped. */
const renderTemplate = (name, data) => {
  if (!templates.has(name)) {
    const filename = path.join(TEMPLATE_DIR, `${name}.ejs`);
    templates.set(
      name,
      ejs.compile(fs.readFileSync(filename, "utf8"), { filename }),
    );
  }
  return templates.get(name)({
    colors: COLORS,
    fontCss: fontCss(),
    cssString,
    ...data,
  });
};

module.exports = {
  COLORS,
  printable,
  showable,
  fitFontSize,
  cssString,
  prepareImage,
  photoUris,
  renderTemplate,
};
