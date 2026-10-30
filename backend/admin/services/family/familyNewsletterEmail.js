const { FamilyMember } = require("@models/FamilyMember");
const { User } = require("@models/UserModel");
const { FamilyMemberStatus } = require("@models/domainEnums");
const { sendTransactionalEmail } = require("@utils/mailer");
const { toObjectId, joinOne } = require("@appServices/family/familyPipeline");

const SEND_BATCH = 10;
const EXCERPT_LENGTH = 300;

const HTML_ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);

/** A header cannot carry a line break, whatever a manager typed into a title. */
const oneLine = (value) =>
  String(value ?? "")
    .replace(/[\r\n]+/g, " ")
    .trim();

const excerpt = (text) => {
  const clean = String(text ?? "").trim();
  return clean.length <= EXCERPT_LENGTH
    ? clean
    : `${clean.slice(0, EXCERPT_LENGTH - 1).trimEnd()}…`;
};

/** Everything a manager typed is escaped: the email shows it as text and never as markup. */
const renderEmailHtml = ({ homeName, title, periodLabel, welcome }) => {
  const note = excerpt(welcome);
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f4f5f8;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden;">
      <div style="background:#1f3a5f;padding:24px 28px;">
        <div style="font-size:12px;letter-spacing:1.5px;color:#c9d3e2;text-transform:uppercase;">${escapeHtml(homeName)}</div>
        <div style="font-family:'Times New Roman',Times,serif;font-size:28px;font-weight:bold;color:#ffffff;margin-top:6px;">${escapeHtml(title)}</div>
        <div style="font-size:13px;color:#c9d3e2;margin-top:6px;">${escapeHtml(periodLabel)}</div>
      </div>
      <div style="padding:24px 28px;font-size:15px;line-height:1.55;">
        <p style="margin:0 0 14px;">Hello,</p>
        <p style="margin:0 0 14px;">${escapeHtml(homeName)} has sent its ${escapeHtml(periodLabel)} newsletter. It is attached to this email as a PDF, and you can read it in the TempyHub app.</p>
        ${note ? `<p style="margin:0 0 14px;padding:14px 16px;background:#f1f3f7;border-radius:8px;">${escapeHtml(note)}</p>` : ""}
        <p style="margin:0;color:#555555;font-size:13px;">Sent with TempyHub</p>
      </div>
    </div>
  </body>
</html>`;
};

/** One address per person, lower case: everyone actively linked to a resident at the site. */
const emailRecipients = async ({ organizationId, branchId }) => {
  const rows = await FamilyMember.aggregate([
    {
      $match: {
        organizationId: toObjectId(organizationId),
        branchId: toObjectId(branchId),
        status: FamilyMemberStatus.ACTIVE,
      },
    },
    { $group: { _id: "$userId" } },
    ...joinOne({ from: User, localField: "_id", as: "user", optional: true }),
    { $project: { _id: 0, email: { $ifNull: ["$user.email", ""] } } },
  ]);

  return [
    ...new Set(
      rows.map((row) => String(row.email).trim().toLowerCase()).filter(Boolean),
    ),
  ];
};

/**
 * Each family member gets their own message with the PDF attached, so nobody sees another family's
 * address. A message that fails is counted and the rest still go out.
 */
const sendNewsletterEmails = async ({
  newsletter,
  homeName,
  periodLabel,
  pdf,
  filename,
  alreadySent = [],
  onSent,
}) => {
  const everyone = await emailRecipients(newsletter);
  const done = new Set(alreadySent);
  const recipients = everyone.filter((address) => !done.has(address));
  if (!everyone.length) return { status: "skipped", count: 0, failed: 0 };

  const subject = oneLine(`${homeName}: ${newsletter.title}`);
  const html = renderEmailHtml({
    homeName,
    title: newsletter.title,
    periodLabel,
    welcome: newsletter.sections?.welcome ? newsletter.welcome?.text : "",
  });
  const attachments = [{ name: filename, content: pdf.toString("base64") }];

  let delivered = done.size;
  let failed = 0;
  let sendingIsOff = false;

  for (let i = 0; i < recipients.length; i += SEND_BATCH) {
    const batch = recipients.slice(i, i + SEND_BATCH);
    const results = await Promise.allSettled(
      batch.map((to) =>
        sendTransactionalEmail({
          to,
          subject,
          html,
          attachments,
          throwOnError: true,
        }),
      ),
    );
    const sent = [];
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        failed += 1;
        console.error("family newsletter email failed", result.reason?.message);
      } else if (result.value?.delivered) {
        delivered += 1;
        sent.push(batch[index]);
      } else {
        sendingIsOff = true;
      }
    });
    if (sent.length && onSent) await onSent(sent);
  }

  if (!delivered && !failed && sendingIsOff)
    return { status: "skipped", count: 0, failed: 0 };
  return { status: delivered ? "done" : "failed", count: delivered, failed };
};

module.exports = {
  sendNewsletterEmails,
  emailRecipients,
  renderEmailHtml,
  escapeHtml,
};
