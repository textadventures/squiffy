import { init as runtimeInit } from 'squiffy-runtime';
import { compile as squiffyCompile } from "squiffy-compiler";
import { getStoryFromCompilerOutput } from "./compiler-helper.ts";

document.addEventListener("DOMContentLoaded", async () => {
    if (!window.opener) {
        const noPreview = document.getElementById("no-preview");
        if (noPreview) {
            noPreview.style.display = "block";
        }

        return;
    }

    const container = document.getElementById("squiffy-container")
    const element = document.getElementById("squiffy");
    if (!container || !element) {
        return;
    }

    container.style.display = "block";

    window.addEventListener('message', async e => {
        const script: string = e.data;

        const result = await squiffyCompile({
            scriptBaseFilename: "filename.squiffy",
            script: script,
        });

        if (!result.success) {
            return;
        }

        const story = getStoryFromCompilerOutput(result.output);

        const squiffyApi = await runtimeInit({
            element: element,
            persist: false,
            story: story,
        });

        const restartButton = document.getElementById('restart');
        restartButton?.addEventListener('click', function () {
            if (confirm('Are you sure you want to restart?')) {
                squiffyApi.restart();
            }
        });

        await squiffyApi.begin();
    });

    window.opener.postMessage('preview-ready', '*');
});