const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });
const moduleAlias = require("module-alias");
const aliases = require("../../aliasConfig/pathAliases.config");
for (const [alias, target] of Object.entries(aliases)) {
  moduleAlias.addAlias(alias, path.join(__dirname, "..", "..", target));
}

const { listRouterPaths } = require("../../backend/config/swagger/walkExpressRoutes");
const { loadPostmanOperations } = require("../../backend/config/swagger/postmanToOpenApi");

const adminRouter = require("../../backend/admin/routes");
const appRouter = require("../../backend/app/routes");
const commonRouter = require("../../backend/commonModules/routes");

const live = [
  ...listRouterPaths(adminRouter, "/admin"),
  ...listRouterPaths(appRouter, "/app"),
  ...listRouterPaths(commonRouter, ""),
];

const shape = (p) =>
  String(p)
    .replace(/\/organizations\/\(\?:\/\(\[\^\/]\+\?\)\)/g, "/organizations/{}")
    .replace(/\{[^}]+\}/g, "{}")
    .replace(/:[A-Za-z0-9_]+/g, "{}");

const liveKeys = live.map((r) => `${r.method} ${shape(r.path)}`);
const { operations } = loadPostmanOperations();
const postmanShapes = new Set(
  operations.map((o) => `${String(o.method).toUpperCase()} ${shape(o.path)}`)
);

const missing = [];
const seen = new Set();
for (let i = 0; i < live.length; i++) {
  const r = live[i];
  const key = liveKeys[i];
  if (seen.has(key)) continue;
  seen.add(key);
  if (!postmanShapes.has(key)) missing.push({ method: r.method, path: r.path });
}

missing.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
console.log(`live=${live.length} postman=${operations.length} missing=${missing.length}`);
for (const row of missing) console.log(`${row.method}\t${row.path}`);
fs.writeFileSync(
  path.join(__dirname, "missing-routes.json"),
  JSON.stringify(missing, null, 2)
);
