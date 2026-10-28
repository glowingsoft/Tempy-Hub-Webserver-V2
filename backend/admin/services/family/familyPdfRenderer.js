const puppeteer = require("puppeteer");

const MAX_PAGES = Number(process.env.PDF_MAX_CONCURRENT) || 3;
const LOAD_TIMEOUT_MS = 30_000;
const PDF_TIMEOUT_MS = 60_000;

let browserPromise = null;

// The browser starts once and is reused; it is started again if it ever closes or crashes.
const getBrowser = () => {
  if (!browserPromise) {
    browserPromise = puppeteer
      .launch({
        headless: true,
        executablePath: process.env.PDF_BROWSER_PATH || undefined,
        // Chromium's sandbox is only switched off where the host cannot run it (some containers), by explicit choice.
        args: process.env.PDF_BROWSER_NO_SANDBOX === "true" ? ["--no-sandbox", "--disable-setuid-sandbox"] : [],
      })
      .then((browser) => {
        browser.on("disconnected", () => {
          browserPromise = null;
        });
        return browser;
      })
      .catch((error) => {
        browserPromise = null;
        throw error;
      });
  }
  return browserPromise;
};

let running = 0;
const waiting = [];
const acquire = () =>
  new Promise((resolve) => {
    if (running < MAX_PAGES) {
      running += 1;
      resolve();
    } else {
      waiting.push(resolve);
    }
  });
const release = () => {
  const next = waiting.shift();
  if (next) next();
  else running -= 1;
};

const pageCountOf = (buffer) => (buffer.toString("latin1").match(/\/Type\s*\/Page(?![A-Za-z])/g) || []).length;

/**
 * Prints the page to an A4 PDF. The page has no scripts and may load nothing but the data inside it, so
 * whatever a manager or family member typed can never run code or reach another address.
 */
const htmlToPdf = async (html) => {
  await acquire();
  let page;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on("request", (request) => (request.url().startsWith("data:") || request.url() === "about:blank" ? request.continue() : request.abort()));

    await page.setContent(html, { waitUntil: "load", timeout: LOAD_TIMEOUT_MS });
    const buffer = Buffer.from(await page.pdf({ preferCSSPageSize: true, printBackground: true, timeout: PDF_TIMEOUT_MS }));
    return { buffer, pageCount: pageCountOf(buffer) };
  } finally {
    if (page) await page.close().catch(() => {});
    release();
  }
};

const closeBrowser = async () => {
  const current = browserPromise;
  browserPromise = null;
  if (current) await (await current).close().catch(() => {});
};

module.exports = { htmlToPdf, closeBrowser };
