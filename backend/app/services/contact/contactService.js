const ContactUs = require("@models/ContactUs");
const validator = require("validator");
const { AppError } = require("@services/_errors/AppError");

const createContactRequest = async ({
  name,
  email,
  phoneNumber,
  description,
}) => {
  if (
    phoneNumber &&
    !validator.isMobilePhone(phoneNumber, "any", { strictMode: true })
  ) {
    throw new AppError("invalid_phone", 400);
  }

  try {
    const contactRequest = new ContactUs({
      name,
      email,
      phoneNumber,
      description,
      status: "pending",
    });

    // Email send kept commented to match previous controller behavior
    // const subject = "Contact Us Request by " + name;
    // const mDescription = phoneNumber
    //   ? `${description} \n Name: ${name} \n Email: ${email} \n Phone Number: ${phoneNumber}`
    //   : `${description} \n Name: ${name} \n Email: ${email}`;
    // const supportEmail = process.env.SUPPORT_EMAIL;
    // await sendEmailViaBrevo([supportEmail], subject, mDescription, { isHtml: false });

    await contactRequest.save();
  } catch (error) {
    if (error.name === "ValidationError") {
      const errorMessages = Object.values(error.errors).map((err) => err.message);
      throw new AppError(errorMessages[0], 400);
    }
    throw error;
  }
};

module.exports = {
  createContactRequest,
};
