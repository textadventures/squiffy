// Packages the app with electron-builder's Node API, on top of package.json's "build" config.
// Run `npm run dist`, which builds the main process and copies in the editor first.
//
// A prerelease (RELEASE_CHANNEL=prerelease, which desktop-publish.yml sets from
// .github/scripts/release-channel.sh) is packaged as a separate app, "Squiffy Beta", as Quest
// Viva's beta is, so it installs beside the stable app and keeps its own settings and recent
// folders. Each override is a different place the app's identity shows:
// - appId: the macOS bundle ID, and the Windows uninstall entry
// - name: the Windows install folder, the .deb package and the Linux executable
// - productName: the app, shortcut and installer names, and the userData folder
// - desktopName: the Linux .desktop file and WM_CLASS, which have to match
// - icons: the purple BETA set in build/beta
import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "electron-builder";

const isBeta = process.env.RELEASE_CHANNEL === "prerelease";

const channelConfig = isBeta
    ? {
        appId: "com.squiffystory.desktop.beta",
        mac: { icon: "build/beta/icon.icns" },
        win: { icon: "build/beta/icon.ico" },
        linux: { icon: "build/beta/icons" },
        extraMetadata: {
            name: "squiffy-desktop-beta",
            productName: "Squiffy Beta",
            desktopName: "squiffy-beta.desktop",
        },
    }
    : {};

// The window icon on Linux, and the About panel's, is an extraResource (resources/icon.png).
// electron-builder adds arrays together when it merges config, so the beta can't swap that
// entry; instead it always points here, and this copies in the right channel's icon.
const iconDir = isBeta ? "build/beta/icons" : "build/icons";
mkdirSync(fileURLToPath(new URL("../resources", import.meta.url)), { recursive: true });
copyFileSync(
    fileURLToPath(new URL(`../${iconDir}/512x512.png`, import.meta.url)),
    fileURLToPath(new URL("../resources/icon.png", import.meta.url)),
);

try {
    // desktop-publish.yml attaches the installers to the GitHub Release itself
    await build({ publish: "never", config: channelConfig });
} catch (err) {
    console.error(err);
    process.exit(1);
}
