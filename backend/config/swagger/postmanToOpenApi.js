const fs = require("fs");
const path = require("path");

const COLLECTION_DIR = path.join(__dirname, "../../../postman_collection");

const newestCollectionPath = () => {
  if (!fs.existsSync(COLLECTION_DIR)) return null;

  const files = fs
    .readdirSync(COLLECTION_DIR)
    .filter(
      (name) =>
        name.endsWith(".postman_collection.json") &&
        !/copy/i.test(name)
    )
    .map((name) => {
      const filePath = path.join(COLLECTION_DIR, name);
      return { filePath, mtime: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);

  const preferred = files.find((file) =>
    path.basename(file.filePath).toLowerCase().includes("tempyhubapi")
  );
  return (preferred || files[0])?.filePath || null;
};

const segmentToParam = (segment) => {
  const decoded = decodeURIComponent(String(segment || "").trim());
  if (!decoded) return null;
  if (decoded.startsWith(":")) return `{${decoded.slice(1)}}`;
  const wrapped = decoded.match(/^\{\{\s*([^}]+)\s*\}\}$/);
  if (wrapped) return `{${wrapped[1]}}`;
  return decoded;
};

const pathFromPostmanUrl = (url) => {
  if (!url) return null;

  let segments = Array.isArray(url.path) ? url.path : null;
  if (!segments && url.raw) {
    const stripped = String(url.raw)
      .replace(/\{\{\s*url\s*\}\}/gi, "")
      .replace(/^https?:\/\/[^/]+\/api\/v1\/?/i, "")
      .replace(/^\/+/, "");
    segments = stripped.split("/");
  }
  if (!segments?.length) return null;

  const parts = segments.map(segmentToParam).filter(Boolean);
  return `/${parts.join("/")}`.replace(/\/+/g, "/");
};

const collectionVars = (collection) => {
  const vars = {};
  for (const entry of collection.variable || []) {
    if (entry?.key) vars[entry.key] = entry.value == null ? "" : String(entry.value);
  }
  return vars;
};

const applyVars = (value, vars) => {
  if (value == null) return value;
  return String(value).replace(/\{\{\s*([^}]+)\s*\}\}/g, (_, key) => {
    const found = vars[key];
    if (found != null && found !== "") return found;
    return key;
  });
};

const exampleFromRaw = (raw, vars) => {
  if (!raw || typeof raw !== "string") return undefined;
  const cleaned = applyVars(raw, vars);
  try {
    return JSON.parse(cleaned);
  } catch {
    return undefined;
  }
};

const schemaFromExample = (value) => {
  if (value === null) return { type: "object", nullable: true };
  if (Array.isArray(value)) {
    return {
      type: "array",
      items: value.length ? schemaFromExample(value[0]) : {},
    };
  }
  if (typeof value === "object") {
    const properties = {};
    for (const [key, child] of Object.entries(value)) {
      properties[key] = schemaFromExample(child);
    }
    return { type: "object", properties };
  }
  if (typeof value === "number") {
    return { type: Number.isInteger(value) ? "integer" : "number", example: value };
  }
  if (typeof value === "boolean") return { type: "boolean", example: value };
  return { type: "string", example: String(value) };
};

const walkItems = (items, folders, acc, vars) => {
  for (const item of items || []) {
    if (item.item) {
      walkItems(item.item, [...folders, item.name].filter(Boolean), acc, vars);
      continue;
    }

    const request = item.request;
    if (!request?.method) continue;

    const openApiPath = pathFromPostmanUrl(request.url);
    if (!openApiPath || openApiPath === "/") continue;

    const method = String(request.method).toLowerCase();
    const tag = folders[0] || "API";
    const example = exampleFromRaw(request.body?.raw, vars);
    const query = (request.url.query || [])
      .filter((param) => param && param.key && !param.disabled)
      .map((param) => ({
        name: param.key,
        in: "query",
        required: false,
        schema: { type: "string" },
        example: applyVars(param.value, vars),
      }));

    const parameters = [];
    const paramMatches = [...openApiPath.matchAll(/\{([^}]+)\}/g)];
    for (const match of paramMatches) {
      const exampleValue = vars[match[1]];
      parameters.push({
        name: match[1],
        in: "path",
        required: true,
        schema: { type: "string" },
        ...(exampleValue ? { example: exampleValue } : {}),
      });
    }
    parameters.push(...query);

    const headers = request.header || [];
    for (const header of headers) {
      if (!header?.key || /^(content-type|authorization)$/i.test(header.key)) continue;
      parameters.push({
        name: header.key,
        in: "header",
        required: false,
        schema: { type: "string" },
        example: applyVars(header.value, vars),
      });
    }

    const operation = {
      tags: [tag],
      summary: item.name || `${method.toUpperCase()} ${openApiPath}`,
      description: request.description || "",
      parameters,
      responses: {
        200: { description: "Success" },
        400: { description: "Bad request" },
        401: { description: "Unauthorized" },
        403: { description: "Forbidden" },
      },
      security: method === "post" && /\/auth\/login$/i.test(openApiPath)
        ? []
        : [{ bearerAuth: [] }],
    };

    if (request.body?.mode === "formdata" && request.body.formdata?.length) {
      const properties = {};
      const required = [];
      for (const field of request.body.formdata) {
        if (!field?.key || field.disabled) continue;
        required.push(field.key);
        if (field.type === "file") {
          properties[field.key] =
            field.key === "files"
              ? {
                  type: "array",
                  items: { type: "string", format: "binary" },
                }
              : { type: "string", format: "binary" };
        } else {
          properties[field.key] = {
            type: "string",
            example: applyVars(field.value, vars),
          };
        }
      }
      if (Object.keys(properties).length) {
        operation.requestBody = {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required,
                properties,
              },
            },
          },
        };
      }
    } else if (example !== undefined && !["GET", "HEAD"].includes(request.method)) {
      operation.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: schemaFromExample(example),
            example,
          },
        },
      };
    }

    acc.push({ method, path: openApiPath, operation });
  }
  return acc;
};

const loadPostmanOperations = () => {
  const filePath = newestCollectionPath();
  if (!filePath) return { filePath: null, operations: [] };

  const collection = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const vars = collectionVars(collection);
  return {
    filePath,
    variables: vars,
    operations: walkItems(collection.item, [], [], vars),
  };
};

module.exports = { loadPostmanOperations, newestCollectionPath };
