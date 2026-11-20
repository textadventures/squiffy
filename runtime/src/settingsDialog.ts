// The Settings dialog (#452): the story's player settings, from squiffy.json's "settings", which
// the player can change at any time. A toggle is a switch, a list a drop-down and a range a
// slider. Changes take effect straight away, and Reset to defaults puts them all back.

import type { PlayerSetting, SquiffyApi } from "./types.js";

// The dialog's text in English. The published page passes in squiffy.json's "strings", which
// use the same names (see PAGE_STRINGS in the compiler).
export const SETTINGS_STRINGS = {
    settings: "Settings",
    resetSettings: "Reset to defaults",
    close: "Close",
};

type SettingsStringName = keyof typeof SETTINGS_STRINGS;

export interface SettingsDialogOptions {
    // The dialog's text, for a story in another language. Anything left out is in English.
    strings?: Partial<Record<string, string>>;
    // Where the dialog goes in the page: the end of the body by default
    container?: HTMLElement;
}

export interface SettingsDialog {
    element: HTMLDialogElement;
    open: () => void;
    close: () => void;
}

// Lucide's settings icon (ISC licence), as on the published page's Settings button
export const SETTINGS_ICON = "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z\"/><circle cx=\"12\" cy=\"12\" r=\"3\"/></svg>";

const ICON_CLOSE = "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M18 6 6 18M6 6l12 12\"/></svg>";

let dialogCount = 0;

export function createSettingsDialog(api: SquiffyApi, options: SettingsDialogOptions = {}): SettingsDialog {
    const strings: Record<SettingsStringName, string> = { ...SETTINGS_STRINGS };
    for (const name of Object.keys(SETTINGS_STRINGS) as SettingsStringName[]) {
        const value = options.strings?.[name];
        if (typeof value == "string") strings[name] = value;
    }
    const id = `squiffy-settings-${++dialogCount}`;

    const dialog = document.createElement("dialog");
    dialog.className = "squiffy-settings";
    dialog.setAttribute("aria-labelledby", `${id}-heading`);
    dialog.innerHTML = `
        <div class="squiffy-settings-header">
            <h2 id="${id}-heading"></h2>
            <button type="button" class="squiffy-settings-close" data-close>${ICON_CLOSE}</button>
        </div>
        <div class="squiffy-settings-list"></div>
        <div class="squiffy-settings-footer">
            <button type="button" class="squiffy-settings-reset" data-reset></button>
        </div>`;
    const $ = <T extends Element>(selector: string) => dialog.querySelector<T>(selector)!;
    $("h2").textContent = strings.settings;
    const closeButton = $<HTMLButtonElement>("[data-close]");
    closeButton.title = strings.close;
    closeButton.setAttribute("aria-label", strings.close);
    closeButton.addEventListener("click", () => dialog.close());
    const list = $<HTMLDivElement>(".squiffy-settings-list");
    const reset = $<HTMLButtonElement>("[data-reset]");
    reset.textContent = strings.resetSettings;
    reset.addEventListener("click", () => {
        api.resetSettings();
        render();
    });
    // Clicking the backdrop closes it too
    dialog.addEventListener("click", event => {
        if (event.target === dialog) dialog.close();
    });
    (options.container ?? document.body).appendChild(dialog);

    // A row for each setting, with the control showing its value now
    function render() {
        list.replaceChildren(...api.getSettings().map((setting, i) => row(setting, `${id}-${i}`)));
    }

    function row(setting: PlayerSetting, controlId: string): HTMLElement {
        const div = document.createElement("div");
        div.className = `squiffy-setting squiffy-setting-${setting.type}`;
        const text = document.createElement("div");
        text.className = "squiffy-setting-text";
        const label = document.createElement("label");
        label.htmlFor = controlId;
        label.textContent = setting.label || setting.name;
        text.appendChild(label);
        if (setting.description) {
            const description = document.createElement("p");
            description.id = `${controlId}-description`;
            description.textContent = setting.description;
            text.appendChild(description);
        }
        div.appendChild(text);

        const value = api.getSetting(setting.name);
        let control: HTMLInputElement | HTMLSelectElement;
        if (setting.type == "toggle") {
            const input = document.createElement("input");
            input.type = "checkbox";
            input.setAttribute("role", "switch");
            input.checked = value === true;
            input.addEventListener("change", () => api.setSetting(setting.name, input.checked));
            control = input;
        }
        else if (setting.type == "list") {
            const select = document.createElement("select");
            for (const option of setting.options) {
                const element = document.createElement("option");
                element.value = option.value;
                element.textContent = option.label;
                select.appendChild(element);
            }
            select.value = String(value);
            select.addEventListener("change", () => api.setSetting(setting.name, select.value));
            control = select;
        }
        else {
            const input = document.createElement("input");
            input.type = "range";
            input.min = String(setting.min);
            input.max = String(setting.max);
            input.step = setting.step ? String(setting.step) : "any";
            input.value = String(value);
            const output = document.createElement("output");
            output.htmlFor.add(controlId);
            output.textContent = String(value);
            input.addEventListener("input", () => {
                api.setSetting(setting.name, Number(input.value));
                output.textContent = String(api.getSetting(setting.name));
            });
            const wrapper = document.createElement("div");
            wrapper.className = "squiffy-setting-slider";
            wrapper.append(input, output);
            control = input;
            control.id = controlId;
            if (setting.description) control.setAttribute("aria-describedby", `${controlId}-description`);
            div.appendChild(wrapper);
            return div;
        }
        control.id = controlId;
        if (setting.description) control.setAttribute("aria-describedby", `${controlId}-description`);
        div.appendChild(control);
        return div;
    }

    return {
        element: dialog,
        open() {
            render();
            if (!dialog.open) dialog.showModal();
            list.querySelector<HTMLElement>("input, select")?.focus();
        },
        close() {
            dialog.close();
        },
    };
}
