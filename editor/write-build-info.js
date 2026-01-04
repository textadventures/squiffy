import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

function run(cmd) {
    return execSync(cmd, { encoding: "utf8" }).trim();
}

// Find the last published tag for this package
const lastTag = run("git describe --tags --abbrev=0");

// Count commits since that tag
const commitsSince = Number(run(`git rev-list ${lastTag}..HEAD --count`));

// Write it to a file that Vite can import
writeFileSync(
    "./src/build-info.json",
    JSON.stringify({ commitsSince }, null, 2)
);

// eslint-disable-next-line no-undef
console.log(`Build info written: ${commitsSince} commits since ${lastTag}`);