import { el, getVersionString } from "./util.ts";

export const clearDebugger = function () {
    el<HTMLElement>("debugger").innerHTML = "";
    logToDebugger(getVersionString());
};

export const logToDebugger = function (text: string) {
    const debuggerEl = el<HTMLElement>("debugger");
    debuggerEl.innerHTML += `${text}<br>`;
    debuggerEl.scrollTop = debuggerEl.scrollHeight;
};