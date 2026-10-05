const os = require("os");

/**
 * Collect non-internal IPv4 addresses for LAN "Network" URLs.
 */
function getLanAddresses() {
  const nets = os.networkInterfaces();
  const ips = [];

  for (const entries of Object.values(nets)) {
    for (const entry of entries || []) {
      const family = entry.family;
      const isV4 = family === "IPv4" || family === 4;
      if (isV4 && !entry.internal) {
        ips.push(entry.address);
      }
    }
  }

  return [...new Set(ips)];
}

function httpBase(host, port) {
  return `http://${host}:${port}`;
}

function httpsBase(host) {
  return host.startsWith("http") ? host.replace(/\/$/, "") : `https://${host}`;
}

function wsBaseFromHttp(httpUrl) {
  return httpUrl.replace(/^http/, "ws");
}

function printBlock(title, lines) {
  console.log(`\n  ${title}`);
  for (const line of lines) {
    console.log(`    ${line}`);
  }
}

/**
 * Print local + network URLs for HTTP API and Socket.IO (same port).
 */
function printStartupUrls({ port, tunnelEnabled = true }) {
  const local = httpBase("localhost", port);
  const lanIps = getLanAddresses();
  const networkBases = lanIps.map((ip) => httpBase(ip, port));
  const tunnelLine = tunnelEnabled
    ? "Tunnel:   starting Cloudflare…"
    : "Tunnel:   skipped (CLOUDFLARE_TUNNEL=false)";

  console.log("\n============================================================");
  console.log(`  Tempy Hub API  (${process.env.NODE_ENV || "dev"})`);
  console.log("============================================================");

  printBlock("HTTP server", [
    `Local:    ${local}`,
    `API:      ${local}/api/v1`,
    `Health:   ${local}/health`,
    `Docs:     ${local}/api-docs`,
    ...(networkBases.length
      ? networkBases.flatMap((base) => [
          `Network:  ${base}`,
          `          ${base}/api/v1`,
          `          ${base}/api-docs`,
        ])
      : ["Network:  (no LAN IPv4 found)"]),
    tunnelLine,
  ]);

  printBlock("Sockets (Socket.IO, same HTTP port)", [
    `Local:    ${local}`,
    `          ${wsBaseFromHttp(local)}`,
    ...(networkBases.length
      ? networkBases.flatMap((base) => [
          `Network:  ${base}`,
          `          ${wsBaseFromHttp(base)}`,
        ])
      : ["Network:  (no LAN IPv4 found)"]),
    tunnelLine,
  ]);

  console.log("\n============================================================\n");

  return { local, networkBases, lanIps };
}

/**
 * Print Cloudflare quick-tunnel URLs once the public hostname is known.
 */
function printTunnelUrls(tunnelUrl) {
  const https = httpsBase(tunnelUrl);
  const wss = https.replace(/^https/, "wss");

  console.log("============================================================");
  console.log("  Cloudflare tunnel ready");
  console.log("============================================================");

  printBlock("HTTP server", [
    `Tunnel:   ${https}`,
    `API:      ${https}/api/v1`,
    `Health:   ${https}/health`,
    `Docs:     ${https}/api-docs`,
  ]);

  printBlock("Sockets (Socket.IO)", [
    `Tunnel:   ${https}`,
    `          ${wss}`,
  ]);

  console.log("\n============================================================\n");

  return { https, wss };
}

module.exports = {
  getLanAddresses,
  printStartupUrls,
  printTunnelUrls,
};
