const PDFDocument = require("pdfkit");
const moment = require("moment-timezone");
const { PAGE, COLORS, registerFonts, printable, prepareImage, drawPhoto } = require("./familyPdfKit");

const MARGIN = 45;
const CONTENT = PAGE.width - MARGIN * 2;
const FOOTER_TOP = PAGE.height - 62;
const BOTTOM = PAGE.height - 80;

const BODY_SIZE = 16;
const MESSAGE_PHOTO = { width: CONTENT, height: 205 };
const COVER_PHOTO = { width: CONTENT, height: 300 };
const LIFE_PHOTO = { width: 200, height: 146 };
const EXTRA_PHOTOS = 3;
const MAX_TITLE_SIZE = 40;
const MIN_TITLE_SIZE = 26;
const BLOCK_GAP = 26;

const firstWord = (name) => printable(name).trim().split(/\s+/)[0] || "";

/** "The Hughes Family Gazette"; a resident known by one name gets "Margaret's Gazette". */
const gazetteTitle = (residentName) => {
  const parts = printable(residentName).trim().split(/\s+/).filter(Boolean);
  return parts.length > 1 ? `The ${parts[parts.length - 1]} Family Gazette` : `${parts[0] || "Your"}'s Gazette`;
};

const periodLabel = ({ periodStart, periodEnd, timezone }) => {
  const start = moment.tz(periodStart, timezone);
  const end = moment.tz(periodEnd, timezone);
  return start.year() === end.year() ? `${start.format("D MMM")} – ${end.format("D MMM YYYY")}` : `${start.format("D MMM YYYY")} – ${end.format("D MMM YYYY")}`;
};

const ensureSpace = (doc, y, needed) => {
  if (y + needed <= BOTTOM) return y;
  doc.addPage();
  return MARGIN;
};

const heading = (doc, label, y) => {
  doc.font("Serif-Bold").fontSize(24).fillColor(COLORS.navy).text(printable(label), MARGIN, y, { width: CONTENT, lineBreak: false });
  doc.moveTo(MARGIN, y + 36).lineTo(MARGIN + CONTENT, y + 36).lineWidth(2).strokeColor(COLORS.navy).stroke();
  return y + 52;
};

const drawCover = (doc, gazette, images) => {
  doc.rect(MARGIN, MARGIN, CONTENT, 10).fill(COLORS.navy);

  doc
    .font("Sans")
    .fontSize(11)
    .fillColor(COLORS.muted)
    .text(`A GAZETTE FOR ${printable(gazette.residentName).toUpperCase()}`, MARGIN, 76, { width: CONTENT, align: "center", characterSpacing: 1.6, lineBreak: false });

  const title = gazetteTitle(gazette.residentName);
  let size = MAX_TITLE_SIZE;
  doc.font("Serif-Bold").fontSize(size);
  while (size > MIN_TITLE_SIZE && doc.widthOfString(printable(title)) > CONTENT) {
    size -= 1;
    doc.fontSize(size);
  }
  doc.fillColor(COLORS.navy).text(printable(title), MARGIN, 98, { width: CONTENT, align: "center", lineBreak: false });

  doc.moveTo(MARGIN, 160).lineTo(MARGIN + CONTENT, 160).lineWidth(0.8).strokeColor(COLORS.ink).stroke();
  const third = CONTENT / 3;
  doc.font("Sans").fontSize(11).fillColor(COLORS.muted);
  doc.text(`Issue ${gazette.issueNumber}`, MARGIN, 168, { width: third, lineBreak: false });
  doc.text(periodLabel(gazette), MARGIN + third, 168, { width: third, align: "center", lineBreak: false });
  doc.text([gazette.homeName, gazette.roomNumber].filter(Boolean).map(printable).join(" · "), MARGIN + third * 2, 168, { width: third, align: "right", lineBreak: false });
  doc.moveTo(MARGIN, 190).lineTo(MARGIN + CONTENT, 190).lineWidth(2.4).strokeColor(COLORS.ink).stroke();

  doc.font("Serif-Bold").fontSize(26).fillColor(COLORS.ink).text(`Dear ${firstWord(gazette.residentName)},`, MARGIN, 222, { width: CONTENT, lineBreak: false });

  let y = 270;
  if (gazette.coverMediaId) {
    drawPhoto(doc, images.get(String(gazette.coverMediaId)), MARGIN, y, COVER_PHOTO, 12);
    y += COVER_PHOTO.height + 14;
  }

  const count = gazette.messages.length;
  doc.font("Sans").fontSize(13).fillColor(COLORS.muted).text(`Your family has sent you ${count} message${count === 1 ? "" : "s"} in this issue.`, MARGIN, y, { width: CONTENT });
  y += 30;

  if (gazette.senders.length) {
    const names = gazette.senders.map(firstWord).filter(Boolean).join(", ");
    doc.font("Sans").fontSize(15);
    const height = doc.heightOfString(`With love from ${names}`, { width: CONTENT - 40 }) + 32;
    doc.roundedRect(MARGIN, y, CONTENT, height, 10).lineWidth(0.8).strokeColor("#d8d3c3").stroke();
    doc.font("Sans").fontSize(15).fillColor(COLORS.ink).text("With love from ", MARGIN + 20, y + 16, { width: CONTENT - 40, continued: true });
    doc.font("Sans-Bold").fillColor(COLORS.navy).text(names);
  }
};

/** From James (Grandson) · 28 Sep, with the name picked out. */
const drawSignature = (doc, message, x, y, width, timezone) => {
  const when = moment.tz(message.createdAt, timezone).format("D MMM");
  doc.font("Sans").fontSize(11.5).fillColor(COLORS.muted).text("From ", x, y, { width, continued: true, lineBreak: false });
  doc.font("Sans-Bold").fillColor(COLORS.accent).text(firstWord(message.authorName) || printable(message.authorName), { continued: true, lineBreak: false });
  doc.font("Sans").fillColor(COLORS.muted).text(`${message.relationshipLabel ? ` (${printable(message.relationshipLabel)})` : ""} · ${when}`, { lineBreak: false });
};

const extraPhotoSlot = () => (CONTENT - 8 * (EXTRA_PHOTOS - 1)) / EXTRA_PHOTOS;
const EXTRA_PHOTO_HEIGHT = 110;

const messageHeights = (doc, message, inner) => {
  const photos = message.mediaIds.length;
  doc.font("Sans").fontSize(BODY_SIZE);
  const text = message.message ? doc.heightOfString(printable(message.message), { width: inner, lineGap: 3 }) : 0;
  const extra = photos > 1 ? EXTRA_PHOTO_HEIGHT + 8 : 0;
  return { photos, text, extra };
};

const drawMessage = (doc, message, y, images, timezone) => {
  const hasPhoto = message.mediaIds.length > 0;
  const pad = 18;
  const inner = hasPhoto ? CONTENT : CONTENT - pad * 2;
  const { text, extra } = messageHeights(doc, message, inner);

  if (!hasPhoto) {
    const height = pad * 2 + text + (text ? 10 : 0) + 16;
    y = ensureSpace(doc, y, height);
    doc.roundedRect(MARGIN, y, CONTENT, height, 10).lineWidth(0.8).strokeColor("#d8d3c3").stroke();
    if (text) doc.font("Sans").fontSize(BODY_SIZE).fillColor(COLORS.ink).text(printable(message.message), MARGIN + pad, y + pad, { width: inner, lineGap: 3 });
    drawSignature(doc, message, MARGIN + pad, y + pad + text + (text ? 10 : 0), inner, timezone);
    return y + height + BLOCK_GAP;
  }

  const height = MESSAGE_PHOTO.height + 10 + extra + (text ? text + 10 : 0) + 16;
  y = ensureSpace(doc, y, height);
  drawPhoto(doc, images.get(String(message.mediaIds[0])), MARGIN, y, MESSAGE_PHOTO, 10);
  let cursor = y + MESSAGE_PHOTO.height + 10;

  if (message.mediaIds.length > 1) {
    const slot = extraPhotoSlot();
    message.mediaIds.slice(1, 1 + EXTRA_PHOTOS).forEach((mediaId, index) => {
      drawPhoto(doc, images.get(String(mediaId)), MARGIN + index * (slot + 8), cursor, { width: slot, height: EXTRA_PHOTO_HEIGHT }, 8);
    });
    cursor += EXTRA_PHOTO_HEIGHT + 8;
  }
  if (text) {
    doc.font("Sans").fontSize(BODY_SIZE).fillColor(COLORS.ink).text(printable(message.message), MARGIN, cursor, { width: inner, lineGap: 3 });
    cursor += text + 10;
  }
  drawSignature(doc, message, MARGIN, cursor, CONTENT, timezone);
  return y + height + BLOCK_GAP;
};

const drawLife = (doc, gazette, y, images) => {
  y = heading(doc, `Life at ${gazette.homeName}`, y);
  const textX = MARGIN + LIFE_PHOTO.width + 22;
  const textWidth = CONTENT - LIFE_PHOTO.width - 22;

  gazette.life.forEach((item) => {
    const hasPhoto = Boolean(item.mediaId);
    const x = hasPhoto ? textX : MARGIN;
    const width = hasPhoto ? textWidth : CONTENT;

    doc.font("Sans-Bold").fontSize(17);
    const titleHeight = item.title ? doc.heightOfString(printable(item.title), { width }) + 6 : 0;
    doc.font("Sans").fontSize(14);
    const textHeight = item.text && item.text !== item.title ? doc.heightOfString(printable(item.text), { width, lineGap: 2 }) + 8 : 0;
    const rowHeight = Math.max(hasPhoto ? LIFE_PHOTO.height : 0, titleHeight + textHeight + 22);

    y = ensureSpace(doc, y, rowHeight + 20);
    if (hasPhoto) drawPhoto(doc, images.get(String(item.mediaId)), MARGIN, y, LIFE_PHOTO, 10);

    let cursor = y;
    if (item.title) {
      doc.font("Sans-Bold").fontSize(17).fillColor(COLORS.ink).text(printable(item.title), x, cursor, { width });
      cursor += titleHeight;
    }
    if (textHeight) {
      doc.font("Sans").fontSize(14).fillColor(COLORS.ink).text(printable(item.text), x, cursor, { width, lineGap: 2 });
      cursor += textHeight;
    }
    if (item.postedAt) doc.font("Sans").fontSize(11).fillColor(COLORS.muted).text(moment.tz(item.postedAt, gazette.timezone).format("D MMM"), x, cursor, { width });
    y += rowHeight + 20;
  });
  return y;
};

const drawClosing = (doc, gazette, y) => {
  if (!gazette.nextClosesAt) return y;
  const when = moment.tz(gazette.nextClosesAt, gazette.timezone).format("D MMM");
  const sentence = `Want to be in the next issue? Share a photo or message in the TempyHub app before ${when}.`;
  doc.font("Sans").fontSize(14);
  const height = doc.heightOfString(sentence, { width: CONTENT - 44, lineGap: 2 }) + 40;
  y = ensureSpace(doc, y, height);
  doc.roundedRect(MARGIN, y, CONTENT, height, 10).fill(COLORS.cream);
  doc.font("Sans").fontSize(14).fillColor(COLORS.ink).text("Want to be in the next issue? Share a photo or message in the TempyHub app before ", MARGIN + 22, y + 20, { width: CONTENT - 44, lineGap: 2, continued: true });
  doc.font("Sans-Bold").text(when, { continued: true });
  doc.font("Sans").text(".");
  return y + height;
};

const drawFooters = (doc, gazette) => {
  const { count } = doc.bufferedPageRange();
  for (let index = 0; index < count; index += 1) {
    doc.switchToPage(index);
    doc.moveTo(MARGIN, FOOTER_TOP).lineTo(MARGIN + CONTENT, FOOTER_TOP).lineWidth(0.8).strokeColor(COLORS.line).stroke();
    doc.font("Sans").fontSize(10.5).fillColor(COLORS.muted);
    doc.text(printable(gazette.homeName), MARGIN, FOOTER_TOP + 10, { width: CONTENT / 2, lineBreak: false });
    doc.text(`Page ${index + 1}`, MARGIN + CONTENT / 2, FOOTER_TOP + 10, { width: CONTENT / 2, align: "right", lineBreak: false });
  }
};

/**
 * One resident's gazette, the way the sample shows it: a cover with the family's title and a letter, "From
 * your family" with every message, "Life at the home" with the wall posts about them, and a note on how to
 * be in the next issue. Large print for easy reading. `photos` maps a media id to the image bytes.
 */
const drawGazette = async ({ gazette, photos = new Map() }) => {
  const doc = new PDFDocument({
    size: "A4",
    margin: 0,
    bufferPages: true,
    info: { Title: printable(gazetteTitle(gazette.residentName)), Author: printable(gazette.homeName), Producer: "TempyHub" },
  });
  const chunks = [];
  doc.on("data", (chunk) => chunks.push(chunk));
  const finished = new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  registerFonts(doc);

  const images = new Map();
  await Promise.all([...photos.entries()].map(async ([id, bytes]) => images.set(String(id), await prepareImage(bytes))));

  drawCover(doc, gazette, images);

  let y = MARGIN;
  if (gazette.messages.length) {
    doc.addPage();
    y = heading(doc, "From your family", MARGIN);
    gazette.messages.forEach((message) => {
      y = drawMessage(doc, message, y, images, gazette.timezone);
    });
  }

  if (gazette.life.length) {
    doc.addPage();
    y = drawLife(doc, gazette, MARGIN, images);
    drawClosing(doc, gazette, y);
  } else {
    drawClosing(doc, gazette, y);
  }

  drawFooters(doc, gazette);
  const pageCount = doc.bufferedPageRange().count;
  doc.end();
  return { buffer: await finished, pageCount };
};

const renderGazettePdf = async (options) => (await drawGazette(options)).buffer;

module.exports = { renderGazettePdf, drawGazette, gazetteTitle, periodLabel };
