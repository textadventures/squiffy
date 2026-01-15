import pkg from "../package.json" with { type: "json" };
import buildInfo from "./build-info.json";

export function el<T>(id: string) {
    return document.getElementById(id) as T;
}

export const getVersionString = function () {
    const version = pkg.version;
    const commitsSince = buildInfo.commitsSince;
    let versionInfo = `Squiffy ${version}`;
    if (commitsSince > 0) {
        versionInfo += `.${commitsSince}`;
    }
    return versionInfo;
};

export const downloadString = function (data: string, filename: string) {
    const blobData = new TextEncoder().encode(data).buffer;
    const blob = new Blob([blobData], { type: "text/plain" });
    downloadBlob(blob, filename);
};

export const downloadUint8Array = function (data: Uint8Array, filename: string) {
    const blobData = new Uint8Array(data).buffer;
    const blob = new Blob([blobData], { type: "application/octet-stream" });
    downloadBlob(blob, filename);
};

export const downloadBlob = function (blob: Blob, filename: string) {
    const downloadLink = document.createElement("a");
    downloadLink.download = filename;
    downloadLink.href = window.URL.createObjectURL(blob);
    downloadLink.onclick = () => {
        document.body.removeChild(downloadLink);
    };
    downloadLink.style.display = "none";
    document.body.appendChild(downloadLink);
    downloadLink.click();
};