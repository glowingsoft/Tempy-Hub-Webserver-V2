const { sendEmailViaBrevo } = require("./emailUtil");

/**
 * Single exit point for transactional mail.
 *
 * No SMTP provider is wired up yet, so by default the message is logged and the
 * actionable link printed to the console — enough to complete an invitation
 * flow in development without silently dropping mail. Set `EMAIL_ENABLED=true`
 * once a provider is configured and the same call starts delivering.
 */
const sendTransactionalEmail = async ({ to, subject, html, previewUrl, attachments, throwOnError = false }) => {
  const recipients = Array.isArray(to) ? to : [to];

  if (process.env.EMAIL_ENABLED === "true") {
    await sendEmailViaBrevo(recipients, subject, html, { attachments, throwOnError });
    return { delivered: true };
  }

  console.log(
    [
      "",
      "✉️  Email not sent (EMAIL_ENABLED is not true)",
      `   To:      ${recipients.join(", ")}`,
      `   Subject: ${subject}`,
      attachments?.length ? `   Attached: ${attachments.map((file) => file.name).join(", ")}` : null,
      previewUrl ? `   Link:    ${previewUrl}` : null,
      "",
    ]
      .filter(Boolean)
      .join("\n")
  );

  return { delivered: false };
};

module.exports = { sendTransactionalEmail };
