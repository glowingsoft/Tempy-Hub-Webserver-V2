// emailTemplate.js
const APP_NAME = "Tempy Hub"; // Define the app name as a constant at the top
const currentYear = new Date().getFullYear(); // Dynamically get the current year

// Function to generate Registration OTP email template
const registrationOtpEmailTemplate = (otp) => `
  <!DOCTYPE html>
  <html>
    <head>
      <style>
        .email-container {
          font-family: Arial, sans-serif;
          line-height: 1.5;
          color: #333;
        }
        .email-header {
          background-color: #118A01;
          color: white;
          text-align: center;
          padding: 10px 0;
        }
        .email-body {
          margin: 20px;
        }
        .otp {
          font-size: 1.5em;
          color: #118A01;
        }
        .footer {
          text-align: center;
          margin-top: 20px;
          color: #888;
        }
      </style>
    </head>
    <body>
      <div class="email-container">
        <div class="email-header">
          <h2>Welcome to ${APP_NAME}</h2>
        </div>
        <div class="email-body">
          <p>Hello,</p>
          <p>Thank you for registering with us. Please use the OTP below to complete your registration:</p>
          <p class="otp"><strong>${otp}</strong></p>
          <p>If you didn't initiate this request, please ignore this email.</p>
        </div>
        <div class="footer">
          &copy; ${currentYear} ${APP_NAME}. All rights reserved.
        </div>
      </div>
    </body>
  </html>
`;

// Function to generate Forgot Password OTP email template
const forgotPasswordOtpEmailTemplate = (otp) => `
  <!DOCTYPE html>
  <html>
    <head>
      <style>
        .email-container {
          font-family: Arial, sans-serif;
          line-height: 1.5;
          color: #333;
        }
        .email-header {
          background-color: #118A01;
          color: white;
          text-align: center;
          padding: 10px 0;
        }
        .email-body {
          margin: 20px;
        }
        .otp {
          font-size: 1.5em;
          color: #118A01;
        }
        .footer {
          text-align: center;
          margin-top: 20px;
          color: #888;
        }
      </style>
    </head>
    <body>
      <div class="email-container">
        <div class="email-header">
          <h2>Password Reset Request</h2>
        </div>
        <div class="email-body">
          <p>Hello,</p>
          <p>We received a request to reset your password for your account at ${APP_NAME}. Please use the OTP below to reset your password:</p>
          <p class="otp"><strong>${otp}</strong></p>
          <p>If you didn't request this password reset, please ignore this email. Your password will remain unchanged.</p>
        </div>
        <div class="footer">
          &copy; ${currentYear} ${APP_NAME}. All rights reserved.
        </div>
      </div>
    </body>
  </html>
`;

const kioskCheckInOtpEmailTemplate = (otp) => `
  <!DOCTYPE html>
  <html>
    <head>
      <style>
        .email-container {
          font-family: Arial, sans-serif;
          line-height: 1.5;
          color: #333;
        }
        .email-header {
          background-color: #118A01;
          color: white;
          text-align: center;
          padding: 10px 0;
        }
        .email-body {
          margin: 20px;
        }
        .otp {
          font-size: 1.5em;
          color: #118A01;
        }
        .footer {
          text-align: center;
          margin-top: 20px;
          color: #888;
        }
      </style>
    </head>
    <body>
      <div class="email-container">
        <div class="email-header">
          <h2>Kiosk Check-in Code</h2>
        </div>
        <div class="email-body">
          <p>Hello,</p>
          <p>We received a request to check in at a ${APP_NAME} kiosk. Please use the OTP below to complete your check-in:</p>
          <p class="otp"><strong>${otp}</strong></p>
          <p>This code expires in 10 minutes.</p>
          <p>If you didn't request this check-in, please ignore this email.</p>
        </div>
        <div class="footer">
          &copy; ${currentYear} ${APP_NAME}. All rights reserved.
        </div>
      </div>
    </body>
  </html>
`;

const stripeEmailTemplate = ({ name, link }) => `
  <!DOCTYPE html>
  <html>
    <head>
      <style>
        .email-container {
          font-family: Arial, sans-serif;
          line-height: 1.5;
          color: #333;
        }
        .email-header {
          background-color: #118A01;
          color: white;
          text-align: center;
          padding: 10px 0;
        }
        .email-body {
          margin: 20px;
        }
        .otp {
          font-size: 1.5em;
          color: #118A01;
        }
        .footer {
          text-align: center;
          margin-top: 20px;
          color: #888;
        }
      </style>
    </head>
    <body>
      <div class="email-container">
        <div class="email-header">
          <h2>Stripe Account Completion</h2>
        </div>
        <div class="email-body">
         <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;margin:0 auto" bgcolor="#fff">
	<tbody>
	<tr>
		<td colspan="2" style="padding:20px 20px 20px 20px">
			<p style="font-family: 'Montserrat', sans-serif; font-size: 15px;">Hey ${name},</p>
			<p style="font-family: 'Montserrat', sans-serif;font-size: 15px;text-align: justify;">
				You’re almost ready to start a whole new Tempy Hub experience
			</p>
			<p style="font-family: 'Montserrat', sans-serif;font-size: 15px;text-align: justify;">
				Simply click the big blue button below to verify the details you have provided to us, so you can be paid on time.
			</p>
			<p style="font-family: 'Montserrat', sans-serif;font-size: 15px;text-align: justify;">
				Before clicking, it is important to remember to have a copy of your <b>ID and a Proof of Address</b> for the verification stage. This is an important anti-fraud measure that helps us to keep your money safe and comply with regulations.
			</p>
			<b style="font-family: 'Montserrat', sans-serif;text-align: justify;">Please see a list of accepted IDs below:</b>
			<ul style="padding-left: 14px;font-family: 'Montserrat', sans-serif; font-size: 15px;text-align: justify; ">
				<li>Valid passport (all four corners must be showing)</li>
				<li>Valid photocard driving licence (not provisional and only if not used for proof of address)</li>
				<li>Valid Government issued national identity card bearing a photograph (electronic copy only - both sides)</li>
			</ul>
			<b style="font-family: 'Montserrat', sans-serif;text-align: justify;">
				We can accept a clear scan of your document or a photo upload
			</b>
			<p style="font-family: 'Montserrat', sans-serif; font-size: 15px;text-align: justify;">Acceptable proof of business or individual address:</p>
			<ul style="padding-left: 14px;font-family: 'Montserrat', sans-serif; font-size: 15px;text-align: justify; ">
				<li>Gas bill / electricity bill / landline telephone bill (maximum 90 days old; may be printed online)</li>
				<li>Council tax bill / water bill (must relate to the current charging period)</li>
			</ul>
			<p style="font-family: 'Montserrat', sans-serif; font-size: 15px;text-align: justify;">
				We are happy to accept a PDF download or screenshot of these documents if your accounts are online and paperless
			</p>
			<a href="${link}" style="font-family: 'Montserrat', sans-serif;background: #118A01;border: none;height: 30px;width: 60%;border-radius: 12px;text-align: center;margin: 0 auto;display: block;color: #fff;cursor: pointer; padding-top:10px">Verify your account</a>
			<p style="font-family: 'Montserrat', sans-serif; font-size: 15px;">
				We wish you a Tempy Hub experience
			</p>
         <p style="font-family: 'Montserrat', sans-serif; font-size: 15px;">
        Best Regards,
        <br>
         Tempy Hub Team
        </p>
		</td>
	</tr>
	</tbody></table>
        </div>
        <div class="footer">
          &copy; ${currentYear} ${APP_NAME}. All rights reserved.
        </div>
      </div>
    </body>
  </html>
`;

// Invitation for a new staff member to join an organization
const staffInvitationEmailTemplate = ({
  inviteeName,
  organizationName,
  branchName,
  roleLabel,
  acceptUrl,
  expiresInDays,
}) => `
  <!DOCTYPE html>
  <html>
    <head>
      <style>
        .email-container {
          font-family: Arial, sans-serif;
          line-height: 1.5;
          color: #333;
        }
        .email-header {
          background-color: #118A01;
          color: white;
          text-align: center;
          padding: 10px 0;
        }
        .email-body {
          margin: 20px;
        }
        .cta {
          display: inline-block;
          background-color: #118A01;
          color: white;
          padding: 12px 24px;
          border-radius: 4px;
          text-decoration: none;
          font-weight: bold;
        }
        .fallback {
          word-break: break-all;
          color: #555;
          font-size: 0.9em;
        }
        .footer {
          text-align: center;
          margin-top: 20px;
          color: #888;
        }
      </style>
    </head>
    <body>
      <div class="email-container">
        <div class="email-header">
          <h2>You have been invited to ${APP_NAME}</h2>
        </div>
        <div class="email-body">
          <p>Hello${inviteeName ? ` ${inviteeName}` : ""},</p>
          <p>
            You have been invited to join <strong>${organizationName}</strong>${
  branchName ? ` at <strong>${branchName}</strong>` : ""
} as <strong>${roleLabel}</strong>.
          </p>
          <p>Set your password to activate your account:</p>
          <p><a class="cta" href="${acceptUrl}">Accept invitation</a></p>
          <p class="fallback">Or paste this link into your browser: ${acceptUrl}</p>
          <p>This invitation expires in ${expiresInDays} days.</p>
          <p>If you were not expecting this, you can ignore this email.</p>
        </div>
        <div class="footer">
          &copy; ${currentYear} ${APP_NAME}. All rights reserved.
        </div>
      </div>
    </body>
  </html>
`;

const familyInvitationEmailTemplate = ({
  inviteeName,
  residentName,
  organizationName,
  branchName,
  acceptUrl,
  expiresInDays,
}) => `
  <!DOCTYPE html>
  <html>
    <head>
      <style>
        .email-container { font-family: Arial, sans-serif; line-height: 1.5; color: #333; }
        .email-header { background-color: #118A01; color: white; text-align: center; padding: 10px 0; }
        .email-body { margin: 20px; }
        .cta { display: inline-block; background-color: #118A01; color: white; padding: 12px 24px; border-radius: 4px; text-decoration: none; font-weight: bold; }
        .fallback { word-break: break-all; color: #555; font-size: 0.9em; }
        .footer { text-align: center; margin-top: 20px; color: #888; }
      </style>
    </head>
    <body>
      <div class="email-container">
        <div class="email-header">
          <h2>Join ${APP_NAME} as family</h2>
        </div>
        <div class="email-body">
          <p>Hello${inviteeName ? ` ${inviteeName}` : ""},</p>
          <p>
            <strong>${organizationName}</strong>${
  branchName ? ` (${branchName})` : ""
} has invited you to stay connected with <strong>${residentName}</strong>.
          </p>
          <p>Set your password to activate your family account:</p>
          <p><a class="cta" href="${acceptUrl}">Accept invitation</a></p>
          <p class="fallback">Or paste this link into your browser: ${acceptUrl}</p>
          <p>This invitation expires in ${expiresInDays} days.</p>
          <p>If you were not expecting this, you can ignore this email.</p>
        </div>
        <div class="footer">
          &copy; ${currentYear} ${APP_NAME}. All rights reserved.
        </div>
      </div>
    </body>
  </html>
`;

const visitorInvitationEmailTemplate = ({
  visitorName,
  organizationName,
  branchName,
  inviteCode,
}) => `
  <!DOCTYPE html>
  <html>
    <head>
      <style>
        .email-container { font-family: Arial, sans-serif; line-height: 1.5; color: #333; }
        .email-header { background-color: #118A01; color: white; text-align: center; padding: 10px 0; }
        .email-body { margin: 20px; }
        .otp { font-size: 1.5em; color: #118A01; letter-spacing: 0.15em; }
        .footer { text-align: center; margin-top: 20px; color: #888; }
      </style>
    </head>
    <body>
      <div class="email-container">
        <div class="email-header">
          <h2>Your ${APP_NAME} visit code</h2>
        </div>
        <div class="email-body">
          <p>Hello${visitorName ? ` ${visitorName}` : ""},</p>
          <p>
            You have been invited to visit <strong>${organizationName}</strong>${
  branchName ? ` at <strong>${branchName}</strong>` : ""
}.
          </p>
          <p>Enter this code on the reception kiosk:</p>
          <p class="otp"><strong>${inviteCode}</strong></p>
          <p>If you did not expect this, you can ignore this email.</p>
        </div>
        <div class="footer">
          &copy; ${currentYear} ${APP_NAME}. All rights reserved.
        </div>
      </div>
    </body>
  </html>
`;

// Export both functions
module.exports = {
  registrationOtpEmailTemplate,
  forgotPasswordOtpEmailTemplate,
  kioskCheckInOtpEmailTemplate,
  stripeEmailTemplate,
  staffInvitationEmailTemplate,
  familyInvitationEmailTemplate,
  visitorInvitationEmailTemplate,
};
