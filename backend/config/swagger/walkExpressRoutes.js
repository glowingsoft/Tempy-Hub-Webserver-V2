/**
 * Lists method + path from an Express 4 router stack.
 * Nested `router.use("/foo", child)` mounts are included.
 */
const joinPaths = (...parts) => {
  const joined = parts
    .flatMap((part) => String(part || "").split("/"))
    .filter(Boolean);
  return `/${joined.join("/")}`;
};

const toOpenApiPath = (expressPath) =>
  String(expressPath || "/")
    .replace(/:([A-Za-z0-9_]+)/g, "{$1}")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "") || "/";

/**
 * Express stores mount points as a regexp, not the original string.
 * Restore "/organizations/:organizationId" from that regexp + layer.keys.
 */
const layerMountPath = (layer) => {
  if (layer.route) {
    const routePath = layer.route.path;
    return Array.isArray(routePath) ? routePath[0] : routePath;
  }

  const keys = layer.keys || [];
  let source = layer.regexp?.source;
  if (!source) return "";

  source = source.replace(/^\^/, "").replace(/\$$/, "");
  source = source.replace(/\\\/\?\(\?=\\\/\|\$\)/, "");
  source = source.replace(/\(\?=\\\/\|\$\)/, "");

  let keyIndex = 0;
  source = source.replace(/\(\?:\(\[\^\\\/]\+\?\)\)/g, () => {
    const name = keys[keyIndex++]?.name;
    return `:${name || "param"}`;
  });
  source = source.replace(/\(\[\^\\\/]\+\?\)/g, () => {
    const name = keys[keyIndex++]?.name;
    return `:${name || "param"}`;
  });

  source = source.replace(/\\\//g, "/").replace(/\\(.)/g, "$1");
  source = source.replace(/\(\?:\/\)\?/g, "");
  source = source.replace(/\/\?$/, "");
  source = source.replace(/\/+/g, "/");

  if (!source || source === "/" || source.includes("(?=")) return "";
  return source.startsWith("/") ? source : `/${source}`;
};

const walkStack = (stack, prefix, acc) => {
  if (!stack) return acc;

  for (const layer of stack) {
    if (layer.route) {
      const full = toOpenApiPath(joinPaths(prefix, layerMountPath(layer)));
      const methods = Object.keys(layer.route.methods || {}).filter(
        (method) => method !== "_all"
      );
      for (const method of methods) {
        acc.push({ method: method.toUpperCase(), path: full });
      }
      continue;
    }

    if (layer.name === "router" && layer.handle?.stack) {
      walkStack(
        layer.handle.stack,
        joinPaths(prefix, layerMountPath(layer)),
        acc
      );
    }
  }

  return acc;
};

const listRouterPaths = (router, prefix = "") => {
  const stack = router?.stack || router?.handle?.stack;
  return walkStack(stack, prefix, []);
};

module.exports = { listRouterPaths, toOpenApiPath };
