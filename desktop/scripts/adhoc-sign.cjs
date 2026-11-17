// electron-builder's afterSign hook (CommonJS, as its hook loader expects), from Quest Viva's.
// Apple Silicon won't open an app with no signature at all ("damaged"), so when there was no
// Developer ID to sign with (CI without the signing secrets, or a machine without one in its
// keychain), this signs it ad hoc. Then macOS just warns that it's from an unidentified developer.
const { execFileSync, spawnSync } = require("node:child_process");
const path = require("node:path");

module.exports = async function adhocSign(context) {
    if (context.electronPlatformName !== "darwin") return;
    const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
    // electron-builder signs with any Developer ID it finds, in CI's keychain or a developer's own.
    // Ad hoc on top of that would replace it.
    // codesign --display writes its details to stderr
    const { stdout, stderr } = spawnSync("codesign", ["--display", "--verbose=2", appPath], { encoding: "utf8" });
    if (/Authority=Developer ID Application/.test(`${stdout}${stderr}`)) return;
    execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], { stdio: "inherit" });
};
