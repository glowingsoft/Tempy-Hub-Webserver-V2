const moment = require("moment-timezone");
const {
  showable,
  renderTemplate,
  TEMPLATE_ROOT,
} = require("@adminServices/family/familyPdfKit");
const { htmlToPdf } = require("@adminServices/family/familyPdfRenderer");

const SCORE_LABELS = [
  ["supervision", "Supervision"],
  ["appraisal", "Appraisal"],
  ["competency", "Competency"],
  ["training", "Training"],
];
const LOW_PERCENT = 60;

const sans = (value) => showable("Sans", value);
const serif = (value) => showable("Serif-Bold", value);

const percentOf = (percent) => ({
  value: percent == null ? "-" : `${percent}%`,
  width: percent == null ? 0 : Math.min(100, Math.max(0, Number(percent))),
  low: percent != null && percent < LOW_PERCENT,
});

const months = (count) => `${count} month${count === 1 ? "" : "s"}`;

const viewOf = ({ siteName, scores, supervisionByDepartment, staff }, day) => {
  const home = sans(siteName || "Your site");
  const dateLabel = moment.utc(day).format("D MMMM YYYY");
  return {
    title: serif("Compliance"),
    siteName: home,
    dateLabel,
    footerLabel: `${home} - ${dateLabel} - Sent with TempyHub`,
    scores: SCORE_LABELS.map(([key, label]) => ({
      label: sans(label),
      ...percentOf(scores[key]),
    })),
    departments: supervisionByDepartment.map((row) => ({
      name: sans(row.department),
      ...percentOf(row.percent),
    })),
    staff: staff.map((row) => ({
      name: sans(row.name),
      frequency: `Every ${months(row.intervalMonths)}${row.customInterval ? " (Custom)" : ""}`,
      cycle: `${row.completedThisCycle} of ${row.expectedThisCycle}`,
      month: `Month ${row.cycleMonth}`,
      dueBy: `Month ${row.dueByMonth}`,
      ...percentOf(row.percent),
      value: row.percent == null ? "Not due yet" : `${row.percent}%`,
    })),
  };
};

const renderCompliancePdf = async ({ report, day }) => {
  const html = renderTemplate("compliance", viewOf(report, day), TEMPLATE_ROOT);
  return (await htmlToPdf(html)).buffer;
};

module.exports = { renderCompliancePdf };
