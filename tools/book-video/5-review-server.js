#!/usr/bin/env node
/*
  5-review-server.js  --  Stage 5 of the book-video curriculum pipeline

  Starts a small local web page where you scroll the extracted structure next
  to the source video frame it came from, fix any wrong titles / page numbers /
  topics / exercise counts by hand, and then click Confirm.

  Confirm writes  tools\book-video\book-structure.confirmed.json .
  Stage 6 refuses to run until that file exists, so nothing proceeds to the
  curriculum module until you've confirmed.

  "Save draft" overwrites book-structure.json instead, so you can stop and come
  back later without confirming.

  RUN
    node tools\book-video\5-review-server.js
      [--port 4599]

  Then open the URL it prints (it also tries to open your browser for you).
  Nothing leaves your machine -- this server only listens on localhost.
*/

const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const DIR = __dirname;
const FRAMES_DIR = path.join(DIR, "frames");
const RAW_DIR = path.join(FRAMES_DIR, "_raw");
const UI_PATH = path.join(DIR, "review-ui.html");
const STRUCTURE_PATH = path.join(DIR, "book-structure.json");
const CONFIRMED_PATH = path.join(DIR, "book-structure.confirmed.json");
const PAGES_JSON = path.join(DIR, "pages.json");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--port") args.port = Number(argv[++i]);
  }
  return args;
}
function fail(msg) {
  console.error("\nStage 5 stopped: " + msg + "\n");
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
const PORT = args.port || 4599;

if (!fs.existsSync(STRUCTURE_PATH) && !fs.existsSync(CONFIRMED_PATH)) {
  fail("no book-structure.json -- run Stage 4 first.");
}
if (!fs.existsSync(UI_PATH)) fail("review-ui.html is missing from " + DIR);

function sendJson(res, code, obj) {
  const s = JSON.stringify(obj);
  res.writeHead(code, { "content-type": "application/json", "content-length": Buffer.byteLength(s) });
  res.end(s);
}
function sendFile(res, filePath, type) {
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
    res.end(buf);
  });
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 20 * 1024 * 1024) reject(new Error("body too large"));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}
// only allow the exact frame filenames we expect -- no path traversal
function safeFrameName(name) {
  return /^(page|raw)-\d{1,6}\.jpg$/i.test(name) ? name : null;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    const pathname = decodeURIComponent(url.pathname);

    if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
      return sendFile(res, UI_PATH, "text/html; charset=utf-8");
    }

    if (req.method === "GET" && pathname === "/api/data") {
      const useConfirmed = fs.existsSync(CONFIRMED_PATH);
      const structure = JSON.parse(fs.readFileSync(useConfirmed ? CONFIRMED_PATH : STRUCTURE_PATH, "utf8"));
      const pages = fs.existsSync(PAGES_JSON) ? JSON.parse(fs.readFileSync(PAGES_JSON, "utf8")) : [];
      const frames = fs.existsSync(FRAMES_DIR)
        ? fs.readdirSync(FRAMES_DIR).filter((f) => /^page-\d+\.jpg$/i.test(f)).sort()
        : [];
      return sendJson(res, 200, {
        loadedFrom: useConfirmed ? "book-structure.confirmed.json" : "book-structure.json",
        hasConfirmed: useConfirmed,
        structure,
        pages,
        frames,
      });
    }

    if (req.method === "GET" && pathname.startsWith("/frames/")) {
      const name = safeFrameName(pathname.slice("/frames/".length));
      if (!name) return sendJson(res, 400, { error: "bad frame name" });
      return sendFile(res, path.join(FRAMES_DIR, name), "image/jpeg");
    }
    if (req.method === "GET" && pathname.startsWith("/raw/")) {
      const name = safeFrameName(pathname.slice("/raw/".length));
      if (!name) return sendJson(res, 400, { error: "bad frame name" });
      return sendFile(res, path.join(RAW_DIR, name), "image/jpeg");
    }

    if (req.method === "POST" && (pathname === "/api/save-draft" || pathname === "/api/confirm")) {
      const body = await readBody(req);
      let incoming;
      try {
        incoming = JSON.parse(body);
      } catch (e) {
        return sendJson(res, 400, { error: "posted body isn't valid JSON" });
      }
      if (!incoming || !Array.isArray(incoming.chapters)) {
        return sendJson(res, 400, { error: "expected an object with a chapters[] array" });
      }
      const target = pathname === "/api/confirm" ? CONFIRMED_PATH : STRUCTURE_PATH;
      if (pathname === "/api/confirm") incoming.confirmedAt = new Date().toISOString();
      else incoming.savedAt = new Date().toISOString();

      // one-time backup of the original extraction the first time we confirm
      if (pathname === "/api/confirm" && !fs.existsSync(CONFIRMED_PATH) && fs.existsSync(STRUCTURE_PATH)) {
        fs.copyFileSync(STRUCTURE_PATH, STRUCTURE_PATH.replace(/\.json$/, ".original.json"));
      }
      fs.writeFileSync(target, JSON.stringify(incoming, null, 2) + "\n");
      return sendJson(res, 200, {
        ok: true,
        wrote: path.basename(target),
        confirmed: pathname === "/api/confirm",
      });
    }

    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  } catch (e) {
    sendJson(res, 500, { error: String(e && e.message || e) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  const link = "http://localhost:" + PORT + "/";
  const bar = "=".repeat(64);
  console.log(bar);
  console.log("  Stage 5 review page is running:  " + link);
  console.log(bar);
  console.log("\n  - Edit titles, page numbers, topics, and exercise counts against the frames.");
  console.log("  - \"Save draft\"  -> overwrites book-structure.json (come back later).");
  console.log("  - \"Confirm\"     -> writes book-structure.confirmed.json (Stage 6 needs this).");
  console.log("\n  Leave this window open while you work. Press Ctrl+C here when you're done.\n");
  // best-effort: open the default browser on Windows
  try {
    spawn("cmd", ["/c", "start", "", link], { stdio: "ignore", detached: true }).unref();
  } catch (e) {
    /* no-op -- just open the link yourself */
  }
});
