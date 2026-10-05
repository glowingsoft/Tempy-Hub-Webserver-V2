const SupportRequest = require("@models/SupportRequest");
const { AppError } = require("@services/_errors/AppError");

const createSupportRequest = async ({ name, email, subject, message }) => {
  try {
    const supportRequest = new SupportRequest({
      name,
      email,
      subject,
      message,
      status: "pending",
    });
    await supportRequest.save();
  } catch (error) {
    if (error.name === "ValidationError") {
      throw new AppError(Object.values(error.errors)[0].message, 400);
    }
    throw error;
  }
};

module.exports = {
  createSupportRequest,
};
