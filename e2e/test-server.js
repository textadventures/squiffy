#!/usr/bin/env node
/* global URL, console, process */

import http from "http";
import { compile } from "../compiler/dist/compiler.js";
import { createPackage } from "../packager/dist/packager.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = 8282;
const TEST_STORIES_DIR = path.join(__dirname, "test-stories");

// Compile and package a story on-the-fly
async function compileStory(storyName) {
  const scriptPath = path.join(TEST_STORIES_DIR, `${storyName}.squiffy`);
  const script = await fs.readFile(scriptPath, "utf8");

  const compileResult = await compile({
    script,
    globalJs: true  // Use global variable instead of ES module export
  });

  if (!compileResult.success) {
    throw new Error(`Compilation failed: ${compileResult.errors.join(", ")}`);
  }

  const pkg = await createPackage(compileResult, false);
  return pkg.files;
}

// Expose the Squiffy API as window.squiffyApi, so tests can call e.g. goBack(). Rather than
// matching the page's own script, which changes, this wraps squiffyRuntime.init() as the runtime
// defines it, from a script at the top of <head>, before any other script runs.
const exposeApiScript = `<script>
(function () {
    let runtime;
    Object.defineProperty(window, "squiffyRuntime", {
        configurable: true,
        get: () => runtime,
        set: value => {
            const init = value.init;
            value.init = async options => {
                const api = await init(options);
                window.squiffyApi = api;
                return api;
            };
            runtime = value;
        },
    });
})();
</script>`;

function exposeApi(html) {
  const head = /<head[^>]*>/i.exec(html);
  if (!head) {
    throw new Error("Can't expose squiffyApi: the packaged index.html has no <head>");
  }
  const at = head.index + head[0].length;
  return html.slice(0, at) + "\n" + exposeApiScript + html.slice(at);
}

const server = http.createServer(async (req, res) => {
  try {
    // Parse URL to get story name and file
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const pathParts = url.pathname.split("/").filter(Boolean);

    if (pathParts.length === 0) {
      // List available stories
      const stories = await fs.readdir(TEST_STORIES_DIR);
      const storyNames = stories
        .filter(f => f.endsWith(".squiffy"))
        .map(f => f.replace(".squiffy", ""));

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`
        <html>
          <head><title>Test Stories</title></head>
          <body>
            <h1>Available Test Stories</h1>
            <ul>
              ${storyNames.map(name => `<li><a href="/${name}/">${name}</a></li>`).join("")}
            </ul>
          </body>
        </html>
      `);
      return;
    }

    const storyName = pathParts[0];
    const fileName = pathParts[1] || "index.html";

    // Compile the story
    const files = await compileStory(storyName);

    if (!files[fileName]) {
      res.writeHead(404);
      res.end("File not found");
      return;
    }

    // Determine content type
    const contentTypes = {
      "html": "text/html",
      "js": "application/javascript",
      "css": "text/css",
    };
    const ext = fileName.split(".").pop();
    const contentType = contentTypes[ext] || "text/plain";

    let content = files[fileName];
    if (fileName === "index.html") {
      content = exposeApi(content);
    }

    res.writeHead(200, { "Content-Type": contentType });
    res.end(content);

  } catch (error) {
    console.error("Server error:", error);
    res.writeHead(500);
    res.end(`Error: ${error.message}`);
  }
});

server.listen(PORT, () => {
  console.log(`Test server running at http://localhost:${PORT}/`);
});

// Handle shutdown
process.on("SIGTERM", () => {
  server.close(() => {
    console.log("Server shut down");
    process.exit(0);
  });
});
