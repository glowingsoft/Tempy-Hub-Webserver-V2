const AdminSettings = require("@models/AdminSettings");
const Faq = require("@models/Faq");
const { generateMeta } = require("@utils/responseUtil");
const { AppError } = require("@services/_errors/AppError");

const getTermsAndConditions = async () => {
  const settings = await AdminSettings.findOne({}, "terms_and_conditions");
  if (!settings) {
    throw new AppError("terms_and", 404);
  }
  return settings;
};

const getAboutUs = async () => {
  const settings = await AdminSettings.findOne({}, "about_us");
  if (!settings) {
    throw new AppError("about_us", 404);
  }
  return settings;
};

const getPrivacyPolicy = async () => {
  const settings = await AdminSettings.findOne({}, "privacy_policy");
  if (!settings) {
    throw new AppError("privacy_policy", 404);
  }
  return settings;
};

const getFaqs = async ({ page, limit, keyword }) => {
  const queryConditions = {};
  if (keyword && keyword.trim() !== "") {
    queryConditions.$or = [
      { question: { $regex: keyword, $options: "i" } },
      { answer: { $regex: keyword, $options: "i" } },
    ];
  }

  const [faqs, totalRecords] = await Promise.all([
    Faq.find(queryConditions)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Faq.countDocuments(queryConditions),
  ]);

  return {
    data: faqs,
    meta: generateMeta(page, limit, totalRecords),
  };
};

const createAdminSettings = async ({
  terms_and_conditions,
  about_us,
  privacy_policy,
  faqs,
}) => {
  const existingSettings = await AdminSettings.findOne();
  if (existingSettings) {
    throw new AppError("admin_settings", 400);
  }

  const newSettings = new AdminSettings({
    terms_and_conditions: terms_and_conditions || "",
    about_us: about_us || "",
    privacy_policy: privacy_policy || "",
    faqs: faqs || "",
  });

  return newSettings.save();
};

const updateAdminSettings = async ({ id, body }) => {
  const updateData = {};
  if (body.terms_and_conditions) {
    updateData.terms_and_conditions = body.terms_and_conditions;
  }
  if (body.about_us) {
    updateData.about_us = body.about_us;
  }
  if (body.privacy_policy) {
    updateData.privacy_policy = body.privacy_policy;
  }
  if (body.faqs) {
    updateData.faqs = body.faqs;
  }

  const settings = await AdminSettings.findByIdAndUpdate(
    id,
    { $set: updateData },
    { new: true, runValidators: true }
  );

  if (!settings) {
    throw new AppError("admin_settings_2", 404);
  }

  return settings;
};

module.exports = {
  getTermsAndConditions,
  getAboutUs,
  getPrivacyPolicy,
  getFaqs,
  createAdminSettings,
  updateAdminSettings,
};
