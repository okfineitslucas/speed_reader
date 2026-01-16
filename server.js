const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

const MIME_TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
};

function sendText(res, status, content, type = "text/plain") {
  res.writeHead(status, {
    "Content-Type": type,
  });
  res.end(content);
}

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (requestUrl.pathname === "/favicon.ico") {
    sendText(res, 204, "");
    return;
  }

  const requestedPath = requestUrl.pathname === "/"
    ? "/index.html"
    : decodeURIComponent(requestUrl.pathname);
  const safePath = path.normalize(requestedPath).replace(/^\.\./, "");
  const filePath = path.join(ROOT, safePath);

  if (!filePath.startsWith(ROOT)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendText(res, 404, "Not Found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME_TYPES[ext] || "application/octet-stream";
    sendText(res, 200, data, type);
  });
});

server.listen(PORT, () => {
  console.log(`Focus Reader running at http://localhost:${PORT}`);
});
