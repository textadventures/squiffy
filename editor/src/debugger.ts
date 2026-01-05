import pkg from "../package.json" with { type: "json" };
import buildInfo from "./build-info.json";
import { el } from "./util.ts";

const version = pkg.version;
const commitsSince = buildInfo.commitsSince;

export const clearDebugger = function () {
    el<HTMLElement>("debugger").innerHTML = "";
    let versionInfo = `Squiffy ${version}`;
    if (commitsSince > 0) {
        versionInfo += `.${commitsSince}`;
    }
    logToDebugger(versionInfo);
};

export const logToDebugger = function (text: string) {
    const debuggerEl = el<HTMLElement>("debugger");
    debuggerEl.innerHTML += `${text}<br>`;
    debuggerEl.scrollTop = debuggerEl.scrollHeight;
};