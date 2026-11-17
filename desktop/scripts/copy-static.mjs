// Copies the editor's static build (app/build) into resources/app-static, which electron-builder
// ships as an extraResource and the main process serves from app:// (src/app-protocol.ts). Build
// the editor first.
import { cpSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../../app/build", import.meta.url));
const dest = fileURLToPath(new URL("../resources/app-static", import.meta.url));

if (!existsSync(`${source}/index.html`)) {
    console.error(`The editor isn't built: there's no ${source}/index.html. Build app/ first.`);
    process.exit(1);
}
rmSync(dest, { recursive: true, force: true });
cpSync(source, dest, { recursive: true });
console.log(`Copied ${source} -> ${dest}`);
