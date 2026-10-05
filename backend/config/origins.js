const isDev = ["dev", "mobileapps"].includes(process.env.NODE_ENV);

const PROD_ORIGINS = [
  "http://localhost:3030",
  "http://localhost:3030/",
];

module.exports = {
  isDev,
  allowedOrigins: isDev ? [] : PROD_ORIGINS,
  connectSrc: isDev ? ["*"] : ["'self'", ...PROD_ORIGINS],
};
