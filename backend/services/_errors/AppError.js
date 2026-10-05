class AppError extends Error {
  constructor(translationKey, statusCode = 400, values = {}) {
    super(translationKey);
    this.name = "AppError";
    this.translationKey = translationKey;
    this.statusCode = statusCode;
    this.values = values;
  }
}

module.exports = { AppError };
