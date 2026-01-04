import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

function run(cmd) {
    return execSync(cmd, { encoding: "utf8" }).trim();
}

let lastTag = null;

try {
    lastTag = run("git describe --tags --abbrev=0");
} catch {
    // eslint-disable-next-line no-undef
    console.warn("No tags found, treating as zero commits since publish");
}

let commitsSince = 0;

if (lastTag) {
    commitsSince = Number(run(`git rev-list ${lastTag}..HEAD --count`));
}

// Write it to a file that Vite can import
writeFileSync(
    "./src/build-info.json",
    JSON.stringify({ commitsSince }, null, 2)
);

// eslint-disable-next-line no-undef
console.log(`Build info written: ${commitsSince} commits since ${lastTag}`);