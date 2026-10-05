const Language = require("@models/Language");
const { User } = require("@models/UserModel");
const { generateMeta } = require("@utils/responseUtil");
const { userCache } = require("@config/nodeCache");
const { AppError } = require("@services/_errors/AppError");

const createLanguage = async ({ title, transliteration, flag, code }) => {
  try {
    const language = new Language({ title, transliteration, flag, code });
    await language.save();
    return language;
  } catch (error) {
    if (error.code === 11000) {
      throw new AppError("language_code_unique_violation", 400);
    }
    throw error;
  }
};

const getLanguages = async ({ page, limit }) => {
  const [languages, totalLanguages] = await Promise.all([
    Language.find({ active: true })
      .sort({ title: 1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Language.countDocuments({ active: true }),
  ]);

  return {
    data: languages,
    meta: generateMeta(page, limit, totalLanguages),
  };
};

const updateLanguage = async ({
  id,
  title,
  transliteration,
  flag,
  code,
  active,
}) => {
  const language = await Language.findById(id);
  if (!language) {
    throw new AppError("language_not_found", 404);
  }

  language.title = title || language.title;
  language.transliteration = transliteration || language.transliteration;
  language.flag = flag || language.flag;
  language.code = code || language.code;
  if (active !== undefined) {
    language.active = active;
  }

  try {
    await language.save();
    return language;
  } catch (error) {
    if (error.name === "ValidationError") {
      throw new AppError(Object.values(error.errors)[0].message, 400);
    }
    throw error;
  }
};

const deleteLanguage = async ({ id }) => {
  const language = await Language.findById(id);
  if (!language) {
    throw new AppError("language_not_found", 404);
  }
  await language.deleteOne();
};

const updateUserLanguage = async ({ userId, languageId }) => {
  const user = await User.findById(userId);
  if (!user) {
    throw new AppError("user_not_found", 404);
  }

  const language = await Language.findById(languageId);
  if (!language) {
    throw new AppError("language_not_found", 404);
  }

  user.language = language.code;
  await user.save();
  userCache.del(userId.toString());

  return { userId, code: language.code };
};

module.exports = {
  createLanguage,
  getLanguages,
  updateLanguage,
  deleteLanguage,
  updateUserLanguage,
};
