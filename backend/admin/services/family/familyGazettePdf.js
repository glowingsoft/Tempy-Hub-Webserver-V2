const moment = require("moment-timezone");
const {
  printable,
  showable,
  fitFontSize,
  photoUris,
  renderTemplate,
} = require("./familyPdfKit");
const { htmlToPdf } = require("./familyPdfRenderer");

const CONTENT_WIDTH = 595.28 - 45 * 2;
const MAX_TITLE_SIZE = 40;
const MIN_TITLE_SIZE = 26;

const sans = (value) => showable("Sans", value);
const serif = (value) => showable("Serif-Bold", value);
const firstWord = (name) => printable(name).trim().split(/\s+/)[0] || "";

/** "The Hughes Family Gazette"; a resident known by one name gets "Margaret's Gazette". */
const gazetteTitle = (residentName) => {
  const parts = printable(residentName).trim().split(/\s+/).filter(Boolean);
  return parts.length > 1
    ? `The ${parts[parts.length - 1]} Family Gazette`
    : `${parts[0] || "Your"}'s Gazette`;
};

const periodLabel = ({ periodStart, periodEnd, timezone }) => {
  const start = moment.tz(periodStart, timezone);
  const end = moment.tz(periodEnd, timezone);
  return start.year() === end.year()
    ? `${start.format("D MMM")} – ${end.format("D MMM YYYY")}`
    : `${start.format("D MMM YYYY")} – ${end.format("D MMM YYYY")}`;
};

const viewOf = ({ gazette, images }) => {
  const photoOf = (mediaId) => images.get(String(mediaId)) ?? null;
  const title = gazetteTitle(gazette.residentName);

  return {
    title: serif(title),
    titleSize: fitFontSize({
      style: "Serif-Bold",
      text: title,
      width: CONTENT_WIDTH,
      max: MAX_TITLE_SIZE,
      min: MIN_TITLE_SIZE,
    }),
    homeName: sans(gazette.homeName),
    residentName: sans(gazette.residentName),
    firstName: serif(firstWord(gazette.residentName)),
    issueNumber: gazette.issueNumber,
    periodLabel: periodLabel(gazette),
    place: [gazette.homeName, gazette.roomNumber]
      .filter(Boolean)
      .map(sans)
      .join(" · "),
    hasCover: Boolean(gazette.coverMediaId),
    cover: gazette.coverMediaId ? photoOf(gazette.coverMediaId) : null,
    senders: gazette.senders
      .map(firstWord)
      .filter(Boolean)
      .map(sans)
      .join(", "),
    messages: gazette.messages.map((message) => ({
      photos: message.mediaIds.map(photoOf),
      text: sans(message.message),
      author: sans(firstWord(message.authorName) || message.authorName),
      relationship: message.relationshipLabel
        ? ` (${sans(message.relationshipLabel)})`
        : "",
      date: moment.tz(message.createdAt, gazette.timezone).format("D MMM"),
    })),
    lifeHeading: serif(`Life at ${gazette.homeName}`),
    life: gazette.life.map((item) => ({
      hasPhoto: Boolean(item.mediaId),
      photo: item.mediaId ? photoOf(item.mediaId) : null,
      title: sans(item.title),
      text: item.text && item.text !== item.title ? sans(item.text) : "",
      date: item.postedAt
        ? moment.tz(item.postedAt, gazette.timezone).format("D MMM")
        : "",
    })),
    closesOn: gazette.nextClosesAt
      ? moment.tz(gazette.nextClosesAt, gazette.timezone).format("D MMM")
      : "",
  };
};

/**
 * One resident's gazette, the way the sample shows it: a cover with the family's title and a letter, "From
 * your family" with every message, "Life at the home" with the wall posts about them, and a note on how to
 * be in the next issue. Large print for easy reading. `photos` maps a media id to the image bytes.
 */
const drawGazette = async ({ gazette, photos = new Map() }) => {
  const images = await photoUris(photos);
  return htmlToPdf(renderTemplate("gazette", viewOf({ gazette, images })));
};

const renderGazettePdf = async (options) => (await drawGazette(options)).buffer;

module.exports = { renderGazettePdf, drawGazette, gazetteTitle, periodLabel };
