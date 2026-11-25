const validator = require("validator");
const { AppError } = require("@services/_errors/AppError");

const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

// each may be sent as "" to clear it
const RULES = {
  name: (value) => value.length <= 100,
  email: (value) => validator.isEmail(value),
  phone: (value) => /^\+?[0-9 ()-]{5,25}$/.test(value),
  opensAt: (value) => CLOCK_TIME.test(value),
  closesAt: (value) => CLOCK_TIME.test(value),
};

/** The database changes for a site's reception contact details; only the fields sent are changed. */
const receptionChanges = (reception) => {
  const invalid = () => new AppError("invalid_reception_details", 400);
  if (!reception || typeof reception !== "object" || Array.isArray(reception))
    throw invalid();

  return Object.fromEntries(
    Object.entries(reception).map(([key, value]) => {
      if (
        !Object.prototype.hasOwnProperty.call(RULES, key) ||
        typeof value !== "string"
      )
        throw invalid();
      const text = value.trim();
      if (text && !RULES[key](text)) throw invalid();
      return [`reception.${key}`, text];
    }),
  );
};

module.exports = { receptionChanges };
