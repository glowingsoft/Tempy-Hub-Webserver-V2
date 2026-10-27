const PDFDocument = require("pdfkit");
const sharp = require("sharp");
const moment = require("moment-timezone");
const path = require("path");
const fontkit = require("fontkit");

const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 45;
const CONTENT = PAGE.width - MARGIN * 2;
const BOTTOM = PAGE.height - MARGIN;
const GAP = 24;

const COLORS = {
  navy: "#1f3a5f",
  ink: "#1a1a1a",
  muted: "#555555",
  soft: "#f1f3f7",
  line: "#d9dde4",
  accent: "#c8553d",
  placeholder: "#dfe5ec",
};

const PHOTO_WIDTH = 600;
const PHOTO_QUALITY = 80;
const HIGHLIGHT_PHOTO = { width: 212, height: 155 };
const GALLERY_PHOTO = { width: 161, height: 113 };
const LABEL_LETTER_SPACING = 1.5;

/**
 * Arimo and Tinos are the fonts the template is set in (the same letter shapes and widths as Arial and
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

const fitText = (doc, text, width, maxLines, size) => {
  doc.fontSize(size);
  const lineHeight = doc.currentLineHeight(true);
  const maxHeight = lineHeight * maxLines;
  if (doc.heightOfString(text, { width }) <= maxHeight) return text;

  let cut = text;
  while (cut.length > 1 && doc.heightOfString(`${cut}…`, { width }) > maxHeight) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
};

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

const ensureSpace = (doc, y, needed) => {
  if (y + needed <= BOTTOM) return y;
  doc.addPage();
  return MARGIN;
};

const sectionHeading = (doc, label, x, y, width = CONTENT) => {
  doc.font("Serif-Bold").fontSize(17).fillColor(COLORS.navy).text(printable(label), x, y, { width, lineBreak: false });
  return y + 28;
};

const drawHeader = (doc, { homeName, title, periodLabel }) => {
  const height = 120;
  doc.roundedRect(MARGIN, MARGIN, CONTENT, height, 10).fill(COLORS.navy);
  doc
    .font("Sans")
    .fontSize(10)
    .fillColor("#c9d3e2")
    .text(printable(homeName).toUpperCase(), MARGIN + 28, MARGIN + 28, { width: CONTENT - 56, characterSpacing: LABEL_LETTER_SPACING, lineBreak: false });
  doc
    .font("Serif-Bold")
    .fontSize(30)
    .fillColor("#ffffff")
    .text(fitText(doc, printable(title), CONTENT - 56, 1, 30), MARGIN + 28, MARGIN + 46, { width: CONTENT - 56, lineBreak: false });
  doc.font("Sans").fontSize(11).fillColor("#c9d3e2").text(printable(periodLabel), MARGIN + 28, MARGIN + 90, { width: CONTENT - 56, lineBreak: false });
  return MARGIN + height + GAP;
};

const drawWelcome = (doc, welcome, y) => {
  const text = printable(welcome.text);
  const signature = printable(welcome.signedBy);
  const inner = CONTENT - 48;

  doc.font("Sans").fontSize(12);
  const textHeight = doc.heightOfString(text, { width: inner, lineGap: 3 });
  const signatureHeight = signature ? 26 : 0;
  const height = textHeight + signatureHeight + 40;

  y = ensureSpace(doc, y, height);
  doc.roundedRect(MARGIN, y, CONTENT, height, 8).fill(COLORS.soft);
  doc.font("Sans").fontSize(12).fillColor(COLORS.ink).text(text, MARGIN + 24, y + 20, { width: inner, lineGap: 3 });
  if (signature) {
    doc.font("Sans-Bold").fontSize(12).fillColor(COLORS.navy).text(signature, MARGIN + 24, y + 20 + textHeight + 10, { width: inner });
  }
  return y + height + GAP;
};

const drawHighlights = (doc, { highlights, homeName, images, timezone }, y) => {
  y = ensureSpace(doc, y, 28 + HIGHLIGHT_PHOTO.height);
  y = sectionHeading(doc, `This month at ${homeName}`, MARGIN, y);

  const textX = MARGIN + HIGHLIGHT_PHOTO.width + 20;
  const textWidth = CONTENT - HIGHLIGHT_PHOTO.width - 20;

  highlights.forEach((item) => {
    y = ensureSpace(doc, y, HIGHLIGHT_PHOTO.height + 14);
    const hasPhoto = Boolean(item.mediaId);
    const x = hasPhoto ? textX : MARGIN;
    const width = hasPhoto ? textWidth : CONTENT;

    if (hasPhoto) drawPhoto(doc, images.get(String(item.mediaId)), MARGIN, y, HIGHLIGHT_PHOTO);

    let cursor = y + 2;
    if (item.title) {
      doc.font("Sans-Bold").fontSize(13).fillColor(COLORS.ink);
      const title = printable(item.title);
      doc.text(title, x, cursor, { width });
      cursor += doc.heightOfString(title, { width }) + 4;
    }
    if (item.text && item.text !== item.title) {
      const body = fitText(doc, printable(item.text), width, 5, 10.5);
      doc.font("Sans").fontSize(10.5).fillColor(COLORS.ink).text(body, x, cursor, { width, lineGap: 2 });
      cursor += doc.heightOfString(body, { width, lineGap: 2 }) + 6;
    }
    if (item.postedAt) {
      doc.font("Sans").fontSize(9).fillColor(COLORS.muted).text(moment.tz(item.postedAt, timezone).format("D MMM"), x, cursor, { width });
      cursor += 14;
    }
    y = Math.max(cursor, hasPhoto ? y + HIGHLIGHT_PHOTO.height : cursor) + 16;
  });
  return y;
};

const COLUMN = { gap: 20 };
COLUMN.left = (CONTENT - COLUMN.gap) / 2;
COLUMN.right = COLUMN.left;

const drawComingUp = (doc, items, x, y, width) => {
  y = sectionHeading(doc, "Coming up", x, y, width);

  items.forEach((item) => {
    const date = moment.utc(item.date).format("ddd D MMM");
    const title = printable(item.title);
    const detail = [item.description, item.category].filter(Boolean).map(printable).join(" · ");
    const titleWidth = width - 92;

    doc.font("Sans-Bold").fontSize(11);
    const titleHeight = doc.heightOfString(title, { width: titleWidth });
    doc.font("Sans").fontSize(9);
    const detailHeight = detail ? doc.heightOfString(detail, { width: titleWidth }) + 2 : 0;
    const rowHeight = Math.max(32, titleHeight + detailHeight + 4);

    doc.font("Sans-Bold").fontSize(11).fillColor(COLORS.accent).text(date, x, y, { width: 86, lineBreak: false });
    if (item.time) doc.font("Sans").fontSize(9).fillColor(COLORS.muted).text(item.time, x, y + 15, { width: 86, lineBreak: false });
    doc.font("Sans-Bold").fontSize(11).fillColor(COLORS.ink).text(title, x + 92, y, { width: titleWidth });
    if (detail) doc.font("Sans").fontSize(9).fillColor(COLORS.muted).text(detail, x + 92, y + titleHeight + 2, { width: titleWidth });

    y += rowHeight + 8;
    doc.moveTo(x, y - 4).lineTo(x + width, y - 4).lineWidth(0.8).strokeColor(COLORS.line).stroke();
  });
  return y;
};

const drawCard = (doc, { title, body }, x, y, width) => {
  const inner = width - 32;
  doc.font("Sans-Bold").fontSize(11.5);
  const titleHeight = doc.heightOfString(printable(title), { width: inner });
  doc.font("Sans").fontSize(10);
  const bodyHeight = body ? doc.heightOfString(printable(body), { width: inner, lineGap: 2 }) : 0;
  const height = titleHeight + bodyHeight + 30;

  doc.roundedRect(x, y, width, height, 8).lineWidth(0.8).strokeColor(COLORS.line).stroke();
  doc.font("Sans-Bold").fontSize(11.5).fillColor(COLORS.ink).text(printable(title), x + 16, y + 14, { width: inner });
  if (body) doc.font("Sans").fontSize(10).fillColor(COLORS.ink).text(printable(body), x + 16, y + 14 + titleHeight + 6, { width: inner, lineGap: 2 });
  return y + height + 12;
};

const drawNotices = (doc, { notices, newResidents }, x, y, width) => {
  if (notices.length) y = sectionHeading(doc, "Notices", x, y, width);
  notices.forEach((notice) => {
    y = drawCard(doc, notice, x, y, width);
  });

  if (newResidents.length) {
    const names = newResidents.map((resident) => `${resident.name}${resident.roomNumber ? ` (Room ${resident.roomNumber})` : ""}`).join(", ");
    const inner = width - 32;
    doc.font("Sans").fontSize(10.5);
    const height = doc.heightOfString(`A warm welcome to: ${printable(names)}`, { width: inner }) + 28;
    doc.roundedRect(x, y, width, height, 8).fill(COLORS.soft);
    doc.font("Sans-Bold").fontSize(10.5).fillColor(COLORS.ink).text("A warm welcome to: ", x + 16, y + 14, { width: inner, continued: true });
    doc.font("Sans").text(printable(names));
    y += height + 12;
  }
  return y;
};

const columnsHeight = (doc, { comingUp, notices, newResidents }) => {
  const left = comingUp.length ? 28 + comingUp.length * 40 : 0;
  const right = notices.length || newResidents.length ? 28 + notices.length * 90 + (newResidents.length ? 60 : 0) : 0;
  return Math.max(left, right);
};

const drawColumns = (doc, content, y) => {
  const showComing = content.comingUp.length > 0;
  const showNotices = content.notices.length > 0 || content.newResidents.length > 0;
  if (!showComing && !showNotices) return y;

  y = ensureSpace(doc, y, Math.min(columnsHeight(doc, content), 300));
  const rightX = MARGIN + COLUMN.left + COLUMN.gap;

  if (showComing && showNotices) {
    const leftEnd = drawComingUp(doc, content.comingUp, MARGIN, y, COLUMN.left);
    const rightEnd = drawNotices(doc, content, rightX, y, COLUMN.right);
    return Math.max(leftEnd, rightEnd) + 12;
  }
  // With only one of them there is nothing to sit beside, so it takes the full width from the left.
  const end = showComing ? drawComingUp(doc, content.comingUp, MARGIN, y, CONTENT) : drawNotices(doc, content, MARGIN, y, CONTENT);
  return end + 12;
};

const drawGallery = (doc, { gallery, images }, y) => {
  const columns = 3;
  const slot = (CONTENT - 16 * (columns - 1)) / columns;
  const photo = { width: slot, height: GALLERY_PHOTO.height };

  y = ensureSpace(doc, y, 28 + photo.height + 24);
  y = sectionHeading(doc, "Photo gallery", MARGIN, y);

  for (let i = 0; i < gallery.length; i += columns) {
    y = ensureSpace(doc, y, photo.height + 26);
    gallery.slice(i, i + columns).forEach((item, column) => {
      const x = MARGIN + column * (slot + 16);
      drawPhoto(doc, images.get(String(item.mediaId)), x, y, photo);
      if (item.caption) doc.font("Sans").fontSize(10).fillColor(COLORS.muted).text(printable(item.caption), x, y + photo.height + 6, { width: slot, lineBreak: false });
    });
    y += photo.height + 30;
  }
  return y;
};

const drawFooter = (doc, footer, y) => {
  y = ensureSpace(doc, y, 70);
  doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT, y).lineWidth(2).strokeColor(COLORS.navy).stroke();
  y += 14;

  const half = CONTENT / 2;
  doc.font("Sans-Bold").fontSize(10.5).fillColor(COLORS.ink).text(printable(footer.homeName), MARGIN, y, { width: half });
  if (footer.address) doc.font("Sans").fontSize(9.5).fillColor(COLORS.muted).text(printable(footer.address), MARGIN, y + 16, { width: half - 10 });

  const lines = [footer.phone, footer.email, "Sent with TempyHub"].filter(Boolean).map(printable);
  doc.font("Sans").fontSize(9.5).fillColor(COLORS.muted);
  lines.forEach((line, index) => doc.text(line, MARGIN + half, y + index * 14, { width: half, align: "right", lineBreak: false }));
};

/**
 * Renders the newsletter the way the template shows it: header, welcome, the month's posts, coming up
 * and notices side by side, the photo gallery and a footer. Only sections that are switched on are drawn.
 * `photos` maps a media id to the image bytes.
 */
const renderNewsletterPdf = async ({ newsletter, organizationName = "", photos = new Map(), timezone = "Europe/London" }) => {
  const doc = new PDFDocument({
    size: "A4",
    margin: 0,
    info: { Title: printable(newsletter.title), Author: printable(newsletter.footer?.homeName || organizationName), Producer: "TempyHub" },
  });
  registerFonts(doc);
  const chunks = [];
  doc.on("data", (chunk) => chunks.push(chunk));
  const finished = new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const images = new Map();
  await Promise.all(
    [...photos.entries()].map(async ([id, bytes]) => {
      images.set(String(id), await prepareImage(bytes));
    })
  );

  const on = newsletter.sections;
  const homeName = newsletter.footer?.homeName || organizationName || "Your home";
  const periodLabel = moment.utc(`${newsletter.month}-01`).format("MMMM YYYY");

  let y = drawHeader(doc, { homeName, title: newsletter.title, periodLabel });
  if (on.welcome && newsletter.welcome?.text) y = drawWelcome(doc, newsletter.welcome, y);
  if (on.highlights && newsletter.highlights.length) {
    y = drawHighlights(doc, { highlights: newsletter.highlights, homeName, images, timezone }, y);
  }
  y = drawColumns(
    doc,
    {
      comingUp: on.comingUp ? newsletter.comingUp : [],
      notices: on.notices ? newsletter.notices : [],
      newResidents: on.newResidents ? newsletter.newResidents : [],
    },
    y
  );
  if (on.gallery && newsletter.gallery.length) y = drawGallery(doc, { gallery: newsletter.gallery, images }, y);
  drawFooter(doc, { ...newsletter.footer, homeName: newsletter.footer?.homeName || homeName }, y);

  doc.end();
  return finished;
};

module.exports = { renderNewsletterPdf, printable };
