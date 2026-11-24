#!/usr/bin/env node
/* global URL, console, process */

import http from "http";
import { compile } from "../compiler/dist/compiler.js";
import { createPackage } from "../packager/dist/packager.js";
import { findStory } from "../compiler/dist/node.js";
import { createPackageFiles } from "../cli/dist/file-packager.js";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = 8282;
const TEST_STORIES_DIR = path.join(__dirname, "test-stories");
const EXAMPLES_DIR = path.join(__dirname, "..", "examples");

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

// The stories in examples/, at /examples/<name>/, built as the CLI builds them (with their
// squiffy.json's panels and settings, their stylesheets, images and sounds), once each, into a
// temporary folder
const exampleBuilds = new Map();
function buildExample(name) {
  if (!/^[\w-]+$/.test(name)) {
    return Promise.reject(new Error(`Not an example: ${name}`));
  }
  if (!exampleBuilds.has(name)) {
    exampleBuilds.set(name, (async () => {
      const story = await findStory(path.join(EXAMPLES_DIR, name));
      const outputPath = await fs.mkdtemp(path.join(os.tmpdir(), `squiffy-e2e-${name}-`));
      const built = await createPackageFiles(story, outputPath, {
        backButton: story.backButton,
        saveButton: story.saveButton,
        startAnywhere: story.startAnywhere,
        strings: story.strings,
      });
      if (!built) {
        throw new Error(`Couldn't build examples/${name}`);
      }
      return outputPath;
    })());
  }
  return exampleBuilds.get(name);
}

const contentTypes = {
  "html": "text/html",
  "js": "application/javascript",
  "css": "text/css",
  "json": "application/json",
  "mp3": "audio/mpeg",
  "png": "image/png",
  "jpg": "image/jpeg",
  "svg": "image/svg+xml",
};

async function serveExample(pathParts, res) {
  const root = await buildExample(pathParts[1]);
  const fileName = pathParts.slice(2).join("/") || "index.html";
  const filePath = path.resolve(root, fileName);
  if (!filePath.startsWith(root + path.sep)) {
    res.writeHead(404);
    res.end("File not found");
    return;
  }
  let content;
  try {
    content = await fs.readFile(filePath);
  } catch {
    res.writeHead(404);
    res.end("File not found");
    return;
  }
  if (fileName === "index.html") {
    content = exposeApi(content.toString("utf8"));
  }
  res.writeHead(200, { "Content-Type": contentTypes[fileName.split(".").pop()] || "application/octet-stream" });
  res.end(content);
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

    if (pathParts[0] === "examples" && pathParts.length > 1) {
      await serveExample(pathParts, res);
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
