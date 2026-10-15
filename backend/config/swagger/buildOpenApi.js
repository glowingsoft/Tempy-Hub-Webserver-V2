const { listRouterPaths } = require("./walkExpressRoutes");
const { loadPostmanOperations } = require("./postmanToOpenApi");
const { attachBody } = require("./requestBodies");

const opKey = (method, path) => `${String(method).toUpperCase()} ${path}`;

const pathParams = (openApiPath) =>
  [...openApiPath.matchAll(/\{([^}]+)\}/g)].map((match) => ({
    name: match[1],
    in: "path",
    required: true,
    schema: { type: "string" },
  }));

const stubOperation = ({ method, path }) => {
  const tag = path.startsWith("/admin")
    ? "Admin"
    : path.startsWith("/app")
      ? "App"
      : path.split("/").filter(Boolean)[0] || "API";

  return {
    tags: [tag],
    summary: `${method} ${path}`,
    description:
      "Live Express route. Add this path to Postman for a richer request body example.",
    parameters: pathParams(path),
    responses: {
      200: { description: "Success" },
      401: { description: "Unauthorized" },
    },
    security: /\/auth\/login$/i.test(path) ? [] : [{ bearerAuth: [] }],
  };
};

const tagFromPath = (path) => {
  if (path.startsWith("/admin/")) {
    const segment = path.split("/")[2];
    return segment ? `Admin / ${segment}` : "Admin";
  }
  if (path.startsWith("/app/")) {
    const segment = path.split("/")[2];
    return segment ? `App / ${segment}` : "App";
  }
  return path.split("/").filter(Boolean)[0] || "API";
};

/**
 * OpenAPI spec = live Express routes ∪ latest Postman collection.
 * New route files show up on server restart without exporting Postman.
 * Postman bodies/summaries are reused when the path+method matches.
 */
const buildOpenApi = ({ adminRouter, appRouter, commonRouter, port }) => {
  const live = [
    ...listRouterPaths(adminRouter, "/admin"),
    ...listRouterPaths(appRouter, "/app"),
    ...listRouterPaths(commonRouter, ""),
  ];

  const { filePath, operations } = loadPostmanOperations();
  const pathShape = (value) => String(value).replace(/\{[^}]+\}/g, "{}");
  const fromPostman = new Map();
  const fromPostmanShape = new Map();
  for (const entry of operations) {
    fromPostman.set(opKey(entry.method, entry.path), entry.operation);
    const shaped = `${String(entry.method).toUpperCase()} ${pathShape(entry.path)}`;
    if (entry.operation.requestBody && !fromPostmanShape.has(shaped)) {
      fromPostmanShape.set(shaped, entry.operation);
    }
  }

  const paths = {};
  const seen = new Set();

  const add = (method, path, operation) => {
    const verb = String(method).toLowerCase();
    if (!paths[path]) paths[path] = {};
    if (!paths[path][verb]) {
      const tagged = {
        ...operation,
        tags: operation.tags?.length ? operation.tags : [tagFromPath(path)],
      };
      if (!tagged.parameters?.some((param) => param.in === "path")) {
        tagged.parameters = [...pathParams(path), ...(tagged.parameters || [])];
      }
      paths[path][verb] = tagged;
    }
    seen.add(opKey(method, path));
  };

  for (const route of live) {
    const existing =
      fromPostman.get(opKey(route.method, route.path)) ||
      fromPostmanShape.get(
        `${route.method} ${pathShape(route.path)}`
      );
    add(
      route.method,
      route.path,
      attachBody(route.method, route.path, existing || stubOperation(route))
    );
  }

  for (const entry of operations) {
    if (!seen.has(opKey(entry.method, entry.path))) {
      add(entry.method, entry.path, entry.operation);
    }
  }

  const hostPort = port || process.env.PORT || 6060;

  return {
    openapi: "3.0.0",
    info: {
      title: "Tempy Hub API",
      version: "1.0.0",
      description: [
        "Generated from live Express routes, with request examples from the latest Postman collection.",
        filePath
          ? `Postman source: ${require("path").basename(filePath)}`
          : "No Postman collection found.",
        "Restart the server after adding a route — it appears here without exporting Postman.",
      ].join(" "),
    },
    servers: [
      { url: `http://localhost:${hostPort}/api/v1`, description: "Local /api/v1" },
    ],
    tags: [...new Set(Object.values(paths).flatMap((ops) =>
      Object.values(ops).flatMap((op) => op.tags || [])
    ))].sort().map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
    },
    security: [{ bearerAuth: [] }],
  };
};

module.exports = { buildOpenApi };
