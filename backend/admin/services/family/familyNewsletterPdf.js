const moment = require("moment-timezone");
const { printable, showable, photoUris, renderTemplate } = require("./familyPdfKit");
const { htmlToPdf } = require("./familyPdfRenderer");

const sans = (value) => showable("Sans", value);
const serif = (value) => showable("Serif-Bold", value);

const viewOf = ({ newsletter, organizationName, images, timezone }) => {
  const on = newsletter.sections;
  const homeName = newsletter.footer?.homeName || organizationName || "Your home";
  const photoOf = (mediaId) => images.get(String(mediaId)) ?? null;

  const newcomers = on.newResidents
    ? newsletter.newResidents.map((resident) => `${resident.name}${resident.roomNumber ? ` (Room ${resident.roomNumber})` : ""}`).join(", ")
    : "";

  return {
    title: serif(newsletter.title),
    homeName: sans(homeName),
    periodLabel: moment.utc(`${newsletter.month}-01`).format("MMMM YYYY"),
    welcome: on.welcome && newsletter.welcome?.text ? { text: sans(newsletter.welcome.text), signedBy: sans(newsletter.welcome.signedBy) } : null,
    highlightsHeading: serif(`This month at ${homeName}`),
    highlights: on.highlights
      ? newsletter.highlights.map((item) => ({
          hasPhoto: Boolean(item.mediaId),
          photo: item.mediaId ? photoOf(item.mediaId) : null,
          title: sans(item.title),
          text: item.text && item.text !== item.title ? sans(item.text) : "",
          date: item.postedAt ? moment.tz(item.postedAt, timezone).format("D MMM") : "",
        }))
      : [],
    comingUp: on.comingUp
      ? newsletter.comingUp.map((item) => ({
          date: moment.utc(item.date).format("ddd D MMM"),
          time: sans(item.time),
          title: sans(item.title),
          detail: [item.description, item.category].filter(Boolean).map(sans).join(" · "),
        }))
      : [],
    notices: on.notices ? newsletter.notices.map((notice) => ({ title: sans(notice.title), body: sans(notice.body) })) : [],
    newcomers: sans(newcomers),
    gallery: on.gallery ? newsletter.gallery.map((item) => ({ photo: photoOf(item.mediaId), caption: sans(item.caption) })) : [],
    footer: {
      homeName: sans(homeName),
      address: sans(newsletter.footer?.address),
      lines: [newsletter.footer?.phone, newsletter.footer?.email, "Sent with TempyHub"].filter(Boolean).map(sans),
    },
  };
};

/**
 * Renders the newsletter the way the template shows it: header, welcome, the month's posts, coming up
 * and notices side by side, the photo gallery and a footer. Only sections that are switched on are drawn.
 * `photos` maps a media id to the image bytes.
 */
const renderNewsletterPdf = async ({ newsletter, organizationName = "", photos = new Map(), timezone = "Europe/London" }) => {
  const images = await photoUris(photos);
  const html = renderTemplate("newsletter", viewOf({ newsletter, organizationName, images, timezone }));
  return (await htmlToPdf(html)).buffer;
};

module.exports = { renderNewsletterPdf, printable };
