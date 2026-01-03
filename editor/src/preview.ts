import { init as runtimeInit } from 'squiffy-runtime';
import { Story } from "squiffy-runtime/dist/types";

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
        const story: Story = e.data;
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