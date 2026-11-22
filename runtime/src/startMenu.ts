// Starting a story at a section the author chooses, to test a late scene without playing up to
// it: "?start=kitchen" on the page's address, and the Start at menu, which lists the story's
// sections as links to those addresses. The published page only has these when the story is
// served by the CLI's --serve, or its squiffy.json has "startAnywhere": true.
//
// A section that needs attributes gets them from "&set=" on the address, once for each setter
// ("?start=vault&set=score=5&set=has_key"), or the author writes a section that sets them and goes
// on to the scene, and marks it with @test, which puts it at the top of the menu.

import type { StartAt, Story } from "./types.js";

// The menu's text in English. The published page passes in squiffy.json's "strings", which use
// the same names (see PAGE_STRINGS in the compiler). [name] is filled in.
export const START_MENU_STRINGS = {
    startAt: "Start at a section",
    findSection: "Find a section",
    testSections: "Test sections",
    allSections: "All sections",
    noSection: "There's no section called \"[name]\".",
    close: "Close",
};

type StartMenuStringName = keyof typeof START_MENU_STRINGS;

// Where an address says to start, if it does
export interface AddressStart {
    // Undefined if the address doesn't say, or names a section the story doesn't have
    startAt?: StartAt;
    // The section it names that the story doesn't have
    notFound?: string;
}

// Reads "?start=section&set=setter&set=setter" from an address's query string
export function startAtFromAddress(search: string, story: Story): AddressStart {
    const params = new URLSearchParams(search);
    const section = params.get("start");
    if (section === null || section === "") return {};
    if (!Object.prototype.hasOwnProperty.call(story.sections, section)) return { notFound: section };
    const set = params.getAll("set").filter(setter => setter.trim());
    return { startAt: { section, ...(set.length ? { set } : {}) } };
}

// The address that starts at a section: the page's own, with only the query string changed
export function addressForStart(section: string): string {
    return "?start=" + encodeURIComponent(section);
}

export interface StartMenuOptions {
    story: Story;
    // Where the menu's button goes: the published page's header. It's added at the start.
    buttons: HTMLElement;
    // The page's query string: window.location.search by default
    search?: string;
    // The menu's text, for a story in another language. Anything left out is in English.
    strings?: Partial<Record<string, string>>;
    // Where the dialog goes in the page: the end of the body by default
    container?: HTMLElement;
}

export interface StartMenu {
    element: HTMLDialogElement;
    button: HTMLButtonElement;
    // Where the address says to start, to give to begin()
    startAt?: StartAt;
    open: () => void;
    close: () => void;
    dispose: () => void;
}

// Lucide's flag icon (ISC licence)
const ICON_FLAG = "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528\"/></svg>";
const ICON_CLOSE = "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M18 6 6 18M6 6l12 12\"/></svg>";

// Sections without names of their own (after a +++ or --- line), which are no use to start at by
// name. The text before the first section is the start of the story.
const unnamed = (name: string) => name === "" || /^_continue\d+$/.test(name);

let dialogCount = 0;

export function createStartMenu(options: StartMenuOptions): StartMenu {
    const strings: Record<StartMenuStringName, string> = { ...START_MENU_STRINGS };
    for (const name of Object.keys(START_MENU_STRINGS) as StartMenuStringName[]) {
        const value = options.strings?.[name];
        if (typeof value == "string") strings[name] = value;
    }
    const { story } = options;
    const { startAt, notFound } = startAtFromAddress(options.search ?? window.location.search, story);
    const id = `squiffy-start-menu-${++dialogCount}`;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "squiffy-header-button squiffy-start-menu-button";
    button.innerHTML = ICON_FLAG;
    button.title = strings.startAt;
    button.setAttribute("aria-label", strings.startAt);
    button.setAttribute("aria-haspopup", "dialog");
    options.buttons.insertBefore(button, options.buttons.firstChild);

    const dialog = document.createElement("dialog");
    dialog.className = "squiffy-settings squiffy-start-menu";
    dialog.setAttribute("aria-labelledby", `${id}-heading`);
    dialog.innerHTML = `
        <div class="squiffy-settings-header">
            <h2 id="${id}-heading"></h2>
            <button type="button" class="squiffy-settings-close" data-close>${ICON_CLOSE}</button>
        </div>
        <p class="squiffy-start-menu-not-found" role="alert" hidden></p>
        <input type="search" class="squiffy-start-menu-find">
        <div class="squiffy-start-menu-list"></div>`;
    const $ = <T extends Element>(selector: string) => dialog.querySelector<T>(selector)!;
    $("h2").textContent = strings.startAt;
    const closeButton = $<HTMLButtonElement>("[data-close]");
    closeButton.title = strings.close;
    closeButton.setAttribute("aria-label", strings.close);
    closeButton.addEventListener("click", () => dialog.close());
    const message = $<HTMLParagraphElement>(".squiffy-start-menu-not-found");
    if (notFound !== undefined) {
        message.textContent = strings.noSection.replace("[name]", notFound);
        message.hidden = false;
    }
    const find = $<HTMLInputElement>(".squiffy-start-menu-find");
    find.placeholder = strings.findSection;
    find.setAttribute("aria-label", strings.findSection);
    const list = $<HTMLDivElement>(".squiffy-start-menu-list");
    // Clicking the backdrop closes it too
    dialog.addEventListener("click", event => {
        if (event.target === dialog) dialog.close();
    });
    (options.container ?? document.body).appendChild(dialog);

    const names = Object.keys(story.sections).filter(name => !unnamed(name));
    const tests = names.filter(name => story.sections[name].test);
    const others = names.filter(name => !story.sections[name].test);

    // The sections whose names have the text typed in: the test sections first, under their own
    // heading if there are any, and then the rest, in the story's order
    function render() {
        const text = find.value.trim().toLowerCase();
        const group = (heading: string, sections: string[]) => {
            const matching = sections.filter(name => name.toLowerCase().includes(text));
            if (!matching.length) return [];
            const ul = document.createElement("ul");
            for (const name of matching) {
                const link = document.createElement("a");
                link.href = addressForStart(name);
                link.textContent = name;
                link.dataset.section = name;
                if (name === startAt?.section) link.setAttribute("aria-current", "true");
                const li = document.createElement("li");
                li.appendChild(link);
                ul.appendChild(li);
            }
            if (!tests.length) return [ul];
            const h3 = document.createElement("h3");
            h3.textContent = heading;
            return [h3, ul];
        };
        list.replaceChildren(...group(strings.testSections, tests), ...group(strings.allSections, others));
    }
    find.addEventListener("input", render);
    // Enter goes to the first section listed
    find.addEventListener("keydown", event => {
        if (event.key == "Enter") list.querySelector<HTMLAnchorElement>("a")?.click();
    });

    const open = () => {
        find.value = "";
        render();
        if (!dialog.open) dialog.showModal();
        find.focus();
    };
    button.addEventListener("click", open);
    // A section that isn't there is most likely a typing mistake, so say so and offer the list
    if (notFound !== undefined) open();

    return {
        element: dialog,
        button,
        ...(startAt ? { startAt } : {}),
        open,
        close() {
            dialog.close();
        },
        dispose() {
            button.remove();
            dialog.remove();
        },
    };
}
