const DEFAULT_FRONTEND_URL = "http://localhost:3000";

const frontendLink = (overrideName, path) => {
  const override = process.env[overrideName];
  const root = (process.env.FRONTEND_URL || DEFAULT_FRONTEND_URL).replace(/\/+$/, "");
  return (override || `${root}${path}`).replace(/\/+$/, "");
};

module.exports = { frontendLink };
