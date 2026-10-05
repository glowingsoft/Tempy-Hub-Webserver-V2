const fs = require("fs");

let tunnelInstance = null;
let starting = null;

function tunnelEnabled() {
  const flag = String(process.env.CLOUDFLARE_TUNNEL || "").toLowerCase();
  if (flag === "false" || flag === "0" || flag === "off") return false;
  if (flag === "true" || flag === "1" || flag === "on") return true;
  // Default: on in non-prod so local/mobile clients get a public URL
  return process.env.NODE_ENV !== "prod";
}

/**
 * Start a Cloudflare quick tunnel to the local HTTP (and Socket.IO) port.
 * Requires the `cloudflared` npm package (binary auto-installed on first run).
 *
 * @param {{ port: number|string }} opts
 * @returns {Promise<string|null>} public https URL or null if skipped/failed
 */
async function startCloudflareTunnel({ port }) {
  if (!tunnelEnabled()) {
    console.log(
      "  Cloudflare tunnel skipped (set CLOUDFLARE_TUNNEL=true to enable).\n"
    );
    return null;
  }

  if (starting) return starting;

  starting = (async () => {
    try {
      const { bin, install, Tunnel } = require("cloudflared");

      if (!fs.existsSync(bin)) {
        console.log("  Downloading cloudflared binary (first run)…");
        await install(bin);
      }

      const localUrl = `http://127.0.0.1:${port}`;
      const tunnel = Tunnel.quick(localUrl);
      tunnelInstance = tunnel;

      tunnel.on("error", (err) => {
        console.warn("  Cloudflare tunnel error:", err?.message || err);
      });

      const url = await Promise.race([
        new Promise((resolve) => tunnel.once("url", resolve)),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("Timed out waiting for tunnel URL")),
            45000
          )
        ),
      ]);

      global.cloudflareTunnelUrl = url;
      return url;
    } catch (err) {
      console.warn(
        `  Cloudflare tunnel unavailable: ${err.message}\n` +
          "  Install/fix the cloudflared package, or set CLOUDFLARE_TUNNEL=false.\n"
      );
      return null;
    } finally {
      starting = null;
    }
  })();

  return starting;
}

function stopCloudflareTunnel() {
  try {
    if (tunnelInstance && typeof tunnelInstance.stop === "function") {
      tunnelInstance.stop();
    }
  } catch (_) {
    // ignore shutdown races
  } finally {
    tunnelInstance = null;
    global.cloudflareTunnelUrl = undefined;
  }
}

module.exports = {
  tunnelEnabled,
  startCloudflareTunnel,
  stopCloudflareTunnel,
};
