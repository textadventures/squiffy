import { SquiffyApi, SquiffyInitOptions, Story, Section, Passage, StartAt, SavedGame, LoadSaveResult } from "./types.js";
import { TextProcessor, errorHtml } from "./textProcessor.js";
import { toNumber } from "./numbers.js";
import { Emitter, SquiffyEventMap } from "./events.js";
import { State } from "./state.js";
import { checkSegment, readTarget, Target } from "./paths.js";
import { updateStory } from "./updater.js";
import { PluginManager } from "./pluginManager.js";
import { Plugins } from "./plugins/index.js";
import { LinkHandler } from "./linkHandler.js";
import { Animation } from "./animation.js";
import { imports } from "./import.js";
import { areInputsValid, setupInputValidation } from "./inputValidation.js";
import { createAssetHtmlResolver, isAbsolute } from "./assets.js";
import { Sound, DEFAULT_FADE } from "./sound.js";
import { EveryTimers } from "./every.js";
import { confirmDialog } from "./confirmDialog.js";
import { createSavesDialog, type SavesDialog } from "./savesDialog.js";
import { createSettingsDialog, type SettingsDialog } from "./settingsDialog.js";
import { PlayerSettings } from "./playerSettings.js";

export type { SquiffyApi, SavedGame, LoadSaveResult, PlayerSetting, PlayerSettingOption, SettingValue } from "./types.js";
export type { SquiffyEventHandler, SquiffyEventMap } from "./events.js";
export { createSavesDialog, formatSaveTime, SAVES_STRINGS, SAVE_FILE_EXTENSION } from "./savesDialog.js";
export type { SavesDialog, SavesDialogOptions, SavesStringName } from "./savesDialog.js";
export { confirmDialog } from "./confirmDialog.js";
export { createSettingsDialog, SETTINGS_STRINGS } from "./settingsDialog.js";
export type { SettingsDialog, SettingsDialogOptions } from "./settingsDialog.js";
export type { ConfirmDialogOptions } from "./confirmDialog.js";
export { indexedDbSaveSlots, memorySaveSlots } from "./saveSlots.js";
export { createPanels } from "./panels.js";
export type { Panels, PanelsOptions } from "./panels.js";
export { PANEL_ICONS } from "./types.js";
export type { Panel, PanelIcon } from "./types.js";
export type { SaveSlot, SaveSlots } from "./saveSlots.js";

export const init = async (options: SquiffyInitOptions): Promise<SquiffyApi> => {
    let story: Story;
    let currentSection: Section;
    let currentSectionElement: HTMLElement;
    let currentPassageElement: HTMLElement | null;
    let currentBlockOutputElement: HTMLElement | null;
    let scrollPosition = 0;
    // Set when the screen is cleared, so the next scroll goes up to the top of the new screen (#54)
    let scrollToTop = false;
    // Errors from setting attributes (e.g. @set gold += abc), shown at the start of the next text
    // written. A link's setters run before the next section has anywhere to show them.
    const pendingErrors: string[] = [];
    const emitter = new Emitter<SquiffyEventMap>();
    const transitions: (() => Promise<void>)[] = [];
    let runningTransitions = false;
    // A {{goto ... after=}} waiting to happen (#375)
    let gotoTimer: ReturnType<typeof setTimeout> | undefined;
    // {{goto}}s followed one after another without the player doing anything, so a loop can't hang
    // the browser
    let gotoHops = 0;
    const MAX_GOTO_HOPS = 100;
    // The {{#every}}s showing their text again and again (#451), and how many sections or passages
    // are being shown, which they wait for
    const everyTimers = new EveryTimers(() => currentSectionElement, tickEvery);
    let navigating = 0;

    async function handleLink(link: HTMLElement): Promise<boolean> {
        if (runningTransitions) return false;
        const outputSection = link.closest(".squiffy-output-section");
        if (outputSection !== currentSectionElement) return false;

        if (link.classList.contains("disabled")) return false;

        // Check if all inputs in the current section are valid before allowing navigation
        if (!areInputsValid(currentSectionElement)) {
            return false;
        }

        const passage = link.getAttribute("data-passage");
        const section = link.getAttribute("data-section");

        if (passage !== null || section !== null) {
            gotoHops = 0;
            // A text box that goes somewhere when Enter is pressed (#454) keeps what was typed
            // first, so the section or passage it goes to can use it. Other text boxes are only
            // kept when the player leaves the section.
            if (link instanceof window.HTMLInputElement) {
                const attribute = link.getAttribute("data-attribute") || link.id;
                if (attribute) set(attribute, link.value);
            }
            // The story-wide turn count (#377). A {{goto}} isn't a turn, as the player didn't click it.
            set("turns", (get("turns") || 0) + 1);
        }

        if (passage !== null) {
            // A passage with @repeat can be clicked again, and doesn't count towards @1, @2... and @last
            let clicked: string | undefined;
            if (!isRepeatPassage(passage)) {
                disableLink(link);
                clicked = markClicked(link);
                set("_turncount", get("_turncount") + 1);
            }
            await processLink(link);
            if (passage) {
                currentBlockOutputElement = null;
                await showPassage(passage, clicked);
            }

            emitter.emit("linkClick", { linkType: "passage" });
            return true;
        }
        
        if (section !== null) {
            await processLink(link);
            if (section) {
                await go(section);
            }

            emitter.emit("linkClick", { linkType: "section" });
            return true;
        }

        const [handled, type, result] = linkHandler.handleLink(link);
        
        if (handled) {
            if (result?.disableLink) {
                disableLink(link);
            }

            save();

            emitter.emit("linkClick", { linkType: type });
            return true;
        }

        return false;
    }

    async function handleClick(event: Event) {
        const target = event.target as HTMLElement;
        if (target.classList.contains("squiffy-link")) {
            await handleLink(target);
        }
    }
    
    function isRepeatPassage(passageName: string) {
        if (!passageName) return false;
        const sectionPassages = currentSection?.passages;
        if (sectionPassages && passageName in sectionPassages) return !!sectionPassages[passageName].repeat;
        const masterPassages = story.sections[""]?.passages;
        return !!(masterPassages && passageName in masterPassages && masterPassages[passageName].repeat);
    }

    // A link, or a text box that goes to a passage when Enter is pressed (#454)
    function disableLink(link: Element) {
        if (link instanceof window.HTMLInputElement) {
            link.disabled = true;
            link.classList.add("disabled");
            return;
        }
        link.classList.add("disabled");
        link.setAttribute("tabindex", "-1");
    }

    function enableLink(link: Element) {
        if (link instanceof window.HTMLInputElement) {
            link.disabled = false;
            link.classList.remove("disabled");
            return;
        }
        link.classList.remove("disabled");
        link.removeAttribute("tabindex");
    }

    // Numbers a passage link that was clicked, so that going back can enable just that link, and
    // not the others to the same passage, such as the other items' links in an {{#each}} (#448)
    function markClicked(link: Element) {
        let max = 0;
        for (const other of outputElement.querySelectorAll("[data-clicked]")) {
            max = Math.max(max, Number(other.getAttribute("data-clicked")) || 0);
        }
        const id = String(max + 1);
        link.setAttribute("data-clicked", id);
        return id;
    }
    
    async function begin(startAt?: StartAt) {
        if (startAt && startAt.section in story.sections) {
            // Start somewhere else in a fresh story, e.g. from the section being edited
            await go(startAt.section);
            if (startAt.passage !== undefined && get("_section") == startAt.section) {
                await showPassage(startAt.passage);
            }
            return;
        }
        if (!load()) {
            await go(story.start);
            return;
        }
        // Saved while waiting for a {{goto}}, so carry on waiting
        await resumeGoto();
        everyTimers.sync();
    }

    async function resumeGoto() {
        const element = currentPassageElement ?? currentSectionElement;
        const section = element?.getAttribute("data-goto");
        if (section && section in story.sections) {
            await followGoto({ section, after: Number(element.getAttribute("data-goto-after") || 0) });
        }
    }

    function cancelGoto() {
        clearTimeout(gotoTimer);
        gotoTimer = undefined;
        textProcessor.goto = null;
        textProcessor.deactivate.clear();
    }

    // Disables the links to the passages that a {{deactivate}} in the text just shown asked for
    // (#13). The element that did it, and each link it disabled, get the same number, so that going
    // back can enable just those links again. A link already disabled by a click is left alone.
    function takeDeactivate(element: HTMLElement) {
        const names = textProcessor.deactivate;
        if (names.size == 0) return;
        const id = String((get("_deactivations") || 0) + 1);
        set("_deactivations", Number(id));
        element.setAttribute("data-deactivates", id);
        for (const link of currentSectionElement.querySelectorAll("a.squiffy-link[data-passage]")) {
            if (names.has(link.getAttribute("data-passage")!) && !link.classList.contains("disabled")) {
                disableLink(link);
                link.setAttribute("data-deactivated-by", id);
            }
        }
        names.clear();
    }

    // Going back: enables the links that the element's {{deactivate}} disabled
    function undoDeactivate(element: HTMLElement) {
        const id = element.getAttribute("data-deactivates");
        if (!id) return;
        for (const link of currentSectionElement.querySelectorAll(`a.squiffy-link[data-deactivated-by="${id}"]`)) {
            enableLink(link);
            link.removeAttribute("data-deactivated-by");
        }
    }

    // Takes the {{goto}} from the text just shown, if there was one, and marks the section or
    // passage element with it, so that going back skips it, and loading resumes it.
    function takeGoto(element: HTMLElement) {
        const pending = textProcessor.goto;
        textProcessor.goto = null;
        if (pending) {
            element.setAttribute("data-goto", pending.section);
            if (pending.after) element.setAttribute("data-goto-after", String(pending.after));
        }
        return pending;
    }

    async function followGoto(pending: { section: string; after: number } | null) {
        if (!pending) return;
        if (pending.after > 0) {
            gotoTimer = setTimeout(() => {
                gotoTimer = undefined;
                gotoHops = 0;
                void go(pending.section);
            }, pending.after);
            return;
        }
        if (++gotoHops > MAX_GOTO_HOPS) {
            gotoHops = 0;
            const element = currentPassageElement ?? currentSectionElement;
            element.removeAttribute("data-goto");
            const message = `stopped after ${MAX_GOTO_HOPS} in a row without the player clicking anything, going to "${pending.section}". Is there a loop?`;
            console.error("Squiffy error in {{goto}}:", message);
            element.insertAdjacentHTML("beforeend", errorHtml("Error in {{goto}}:", message));
            save();
            return;
        }
        await go(pending.section);
    }
    
    async function processLink(link: HTMLElement) {
        animation.runLinkAnimation(link);
        await runTransitions();
        const settersJson = link.getAttribute("data-set");
        if (settersJson) {
            const setters = JSON.parse(settersJson) as string[];
            for (const attribute of setters) {
                setAttribute(attribute);
            }
        }
    }
    
    // Runs a setter from @set or a link, e.g. gold += 5. An error leaves the attribute as it was,
    // and is shown with the next text written.
    function setAttribute(expr: string) {
        try {
            if (story.expressions) {
                setWithExpression(expr);
            }
            else {
                setWithoutExpression(expr);
            }
        }
        catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            console.error(`Squiffy error in "${expr}":`, message);
            pendingErrors.push(errorHtml(`Error in "${expr}":`, message));
        }
    }

    // +=, -=, *= and /=, which only work on numbers (#374)
    function operate(lhs: string | string[], op: string, amountValue: unknown) {
        const what = op + "=";
        const amount = toNumber(what, amountValue);
        const path = typeof lhs == "string" ? [lhs] : lhs;
        let value = toNumber(what, state.getAt(path));
        if (op == "+") value += amount;
        if (op == "-") value -= amount;
        if (op == "*") value *= amount;
        if (op == "/") value /= amount;
        state.setAt(path, value);
    }

    // The path a setter's target names, with any [index] in it worked out, e.g. ["inventory", "2",
    // "name"] for inventory[i].name when i is 2 (#442)
    function targetPath(target: Target): string[] {
        return [target.attribute, ...target.segments.map(segment => {
            if ("name" in segment) return segment.name;
            const index = textProcessor.evaluate(segment.index);
            if (typeof index != "string" && typeof index != "number") {
                throw new Error(`[${segment.index.trim()}] should be a number or text, to say which value to set`);
            }
            const name = String(index);
            checkSegment(name);
            return name;
        })];
    }

    // A story with a squiffy.json (#373): the right-hand side is an expression, with the same rules
    // as {{#if}}, e.g. weapon = "sword", gold = gold + price * 2, rich = gold > 100. The left-hand
    // side can be a value inside an object, e.g. hero.hp = 10 or inventory[i].name = "lamp" (#442).
    function setWithExpression(expr: string) {
        const target = readTarget(expr);
        const textMatch = target && /^\s*:=(.*)$/.exec(target.rest);
        if (target && textMatch) {
            // Text with {{...}} processed, as before
            state.setAt(targetPath(target), ui.processText(textMatch[1], true));
            return;
        }
        const match = target && /^\s*([+\-*/]?)=(?!=)(.*)$/.exec(target.rest);
        if (target && match) {
            const [, op, rhs] = match;
            const path = targetPath(target);
            const value = textProcessor.evaluate(rhs);
            if (op) {
                operate(path, op, value);
            }
            else {
                state.setAt(path, value);
            }
            return;
        }
        const not = /^\s*not\s+/.exec(expr);
        const flag = readTarget(not ? expr.substring(not[0].length) : expr);
        if (!flag || flag.rest.trim()) {
            throw new Error("expected an attribute name, e.g. gold = 10, gold += 5, has_key or not has_key");
        }
        state.setAt(targetPath(flag), !not);
    }

    // A story without a squiffy.json, as in Squiffy 6: the right-hand side is a number, true,
    // false, @attribute, or else text
    function setWithoutExpression(expr: string) {
        expr = expr.replace(/^(\w*\s*):=(.*)$/, (_, name, value) => (name + "=" + ui.processText(value, true)));
        const setRegex = /^([\w]*)\s*=\s*(.*)$/;
        const setMatch = setRegex.exec(expr);
        if (setMatch) {
            const lhs = setMatch[1];
            let rhs: any = setMatch[2];
            if (rhs === "true") {
                set(lhs, true);
            }
            else if (rhs === "false") {
                set(lhs, false);
            }
            else if (isNaN(rhs as any)) {
                if (rhs.startsWith("@")) rhs = get(rhs.substring(1));
                set(lhs, rhs);
            }
            else {
                set(lhs, parseFloat(rhs));
            }
        }
        else {
            const incDecRegex = /^([\w]*)\s*([+\-*/])=\s*(.*)$/;
            const incDecMatch = incDecRegex.exec(expr);
            if (incDecMatch) {
                const lhs = incDecMatch[1];
                const op = incDecMatch[2];
                const rhsText = incDecMatch[3].trim();
                operate(lhs, op, rhsText.startsWith("@") ? get(rhsText.substring(1)) : rhsText);
            }
            else {
                let value = true;
                if (expr.startsWith("not ")) {
                    expr = expr.substring(4);
                    value = false;
                }
                set(expr, value);
            }
        }
    }

    async function go(sectionName: string) {
        navigating++;
        try {
            await goNow(sectionName);
        }
        finally {
            navigating--;
            everyTimers.sync();
        }
    }

    async function goNow(sectionName: string) {
        cancelGoto();
        const oldCanGoBack = canGoBack();
        currentSection = story.sections[sectionName];
        if (!currentSection) return;
        const sectionBefore = get("_section");
        if (sectionBefore !== null) {
            // Where the player was before this (#56): the section, or the passage in it shown last
            set("previous", get("_passage") ?? sectionBefore);
            set("previous_section", sectionBefore);
        }
        if (get("_passage") !== null) set("_passage", null);
        set("_section", sectionName);
        // The story-wide turn count starts at 0 (#377), in a new story or one saved before it existed.
        // It isn't a change the player made, so it isn't undone.
        if (get("turns") === null) state.setInternal("turns", 0, false);
        state.setSeen(sectionName);
        const master = story.sections[""];
        const clear = master?.clear || currentSection.clear;
        // @leave: the old text goes before anything changes on the screen
        if (clear) await leaveTransition([currentSection, master]);
        // @class (#449): this section's classes replace the last one's
        setSectionClasses([...(master?.classes ?? []), ...(currentSection.classes ?? [])]);
        if (clear) {
            clearScreen();
        }
        newSection(sectionName);
        startTransition(currentSectionElement, [currentSection, master]);
        const sectionElement = currentSectionElement;
        if (master) {
            await run(master, "[[]]");
            if (get("_section") !== sectionName) {
                // JS in the master section navigated away; clean up the empty element we created.
                sectionElement.remove();
                return;
            }
        }
        await run(currentSection, `[[${sectionName}]]`);

        if (get("_section") !== sectionName) {
            // JS in this section navigated away; clean up the empty element we created.
            sectionElement.remove();
            return;
        }

        // Setup validation after transitions complete (animations may have replaced DOM elements)
        setupInputValidation(currentSectionElement);

        set("_turncount", 0);
        takeDeactivate(currentSectionElement);
        const pending = takeGoto(currentSectionElement);
        writeUndoLog();
        save();

        const newCanGoBack = canGoBack();
        if (newCanGoBack != oldCanGoBack) {
            emitter.emit("canGoBackChanged", { canGoBack: newCanGoBack });
        }
        emitter.emit("navigated", { section: sectionName });
        await followGoto(pending);
    }

    let inAfterWrite = false;

    // afterWrite: where squiffy.ui.afterWrite queues its functions, for a section or passage's JS (#106)
    function runJs(index: number, extra: any = null, afterWrite?: (() => void)[]) {
        const squiffy = {
            get: get,
            set: set,
            ui: {
                transition: addTransition,
                write: ui.write,
                scrollToEnd: ui.scrollToEnd,
                afterWrite: (fn: () => void) => {
                    if (!afterWrite) {
                        throw new Error("squiffy.ui.afterWrite can only be used in a section or passage's JavaScript");
                    }
                    afterWrite.push(fn);
                },
            },
            story: {
                // In an afterWrite function, the section's text is already on the page, so going
                // somewhere else waits until it has finished, like {{goto}} (#106)
                go: (sectionName: string) => {
                    if (!inAfterWrite) return go(sectionName);
                    textProcessor.goto ??= { section: sectionName, after: 0 };
                    return Promise.resolve();
                },
                seen: (sectionOrPassage: string) => state.getSeen(sectionOrPassage),
                visits: (sectionOrPassage: string) => state.getVisits(sectionOrPassage),
            },
            element: outputElementContainer,
            import: imports,
            ...extra
        };
        story.js[index](squiffy, get, set);
    }
    
    async function run(section: Section, source: string) {
        if (section.attributes) {
            await processAttributes(section.attributes);
        }
        // @music and @sound (#444)
        if (section.music !== undefined) set("_music", section.music);
        for (const file of section.sounds ?? []) {
            if (file == "stop") sound.stopSounds();
            else sound.play(file);
        }
        const afterWrite: (() => void)[] = [];
        if (section.jsIndex !== undefined) {
            const sectionBefore = get("_section");
            runJs(section.jsIndex, null, afterWrite);
            if (get("_section") !== sectionBefore) {
                // JS called squiffy.story.go() and navigated away; the destination
                // section will handle rendering its own content.
                return;
            }
        }

        ui.write(section.text || "", source);

        // Functions from squiffy.ui.afterWrite run once the text and its {{...}} are on the page (#106)
        inAfterWrite = true;
        try {
            for (const fn of afterWrite) fn();
        }
        finally {
            inAfterWrite = false;
        }

        await runTransitions();
    }

    async function runTransitions() {
        runningTransitions = true;
        currentSectionElement.classList.add("links-disabled");
        for (const transition of transitions) {
            await transition();
        }
        transitions.length = 0;
        runningTransitions = false;
        currentSectionElement.classList.remove("links-disabled");
    }
    
    // clicked: the number markClicked gave the link that was clicked to get here, if any
    async function showPassage(passageName: string, clicked?: string) {
        navigating++;
        try {
            await showPassageNow(passageName, clicked);
        }
        finally {
            navigating--;
            everyTimers.sync();
        }
    }

    async function showPassageNow(passageName: string, clicked?: string) {
        cancelGoto();
        const oldCanGoBack = canGoBack();
        let passage = currentSection.passages && currentSection.passages[passageName];
        const masterSection = story.sections[""];
        if (!passage && masterSection && masterSection.passages) passage = masterSection.passages[passageName];
        if (!passage) {
            throw `No passage named ${passageName} in the current section or master section`;
        }
        // The section or passage shown before this one (#56)
        set("previous", get("_passage") ?? get("_section"));
        set("_passage", passageName);
        state.setSeen(passageName);

        const passages: Passage[] = [];
        const runFns: (() => Promise<void>)[] = [];

        if (masterSection && masterSection.passages) {
            const masterPassage = masterSection.passages[""];
            if (masterPassage) {
                passages.push(masterPassage);
                runFns.push(() => run(masterPassage, "[[]][]"));
            }
        }

        const master = currentSection.passages && currentSection.passages[""];
        if (master) {
            passages.push(master);
            runFns.push(() => run(master, `[[${get("_section")}]][]`));
        }

        passages.push(passage);
        runFns.push(() => run(passage, `[[${get("_section")}]][${passageName}]`));

        const turnPassageName = "@" + get("_turncount");
        // A passage with @repeat doesn't count as a turn, so @1, @2... and @last ran already if they're due
        if (currentSection.passages && !passage.repeat) {
            if (turnPassageName in currentSection.passages) {
                const turnPassage = currentSection.passages[turnPassageName];
                passages.push(turnPassage);
                runFns.push(() => run(turnPassage, `[[${get("_section")}]][${turnPassageName}]`));
            }
            if ("@last" in currentSection.passages && get("_turncount") >= (currentSection.passageCount || 0)) {
                const turnPassage = currentSection.passages["@last"];
                passages.push(turnPassage);
                runFns.push(() => run(turnPassage, `[[${get("_section")}]][${turnPassageName}]`));
            }
        }

        const clear = passages.some(p => p.clear);
        // @leave: the passage's own, or else a master passage's, or else its section's, or the master section's
        if (clear) await leaveTransition([passage, master, masterSection?.passages?.[""], currentSection, masterSection]);

        // @class in a passage (#449) adds to the section's classes
        const passageClasses = passages.flatMap(p => p.classes ?? []);
        if (passageClasses.length) setSectionClasses([...sectionClasses(), ...passageClasses]);

        if (clear) {
            clearScreen();
            createSectionElement();
        }

        currentPassageElement = document.createElement("div");
        currentPassageElement.classList.add("squiffy-output-passage");
        currentPassageElement.setAttribute("data-passage", `${passageName}`);
        if (clicked) currentPassageElement.setAttribute("data-clicked-link", clicked);

        currentSectionElement.appendChild(currentPassageElement);
        // @transition (#489): the passage's own, or else a master passage's, or else its section's, or the master section's
        startTransition(currentPassageElement, [passage, master, masterSection?.passages?.[""], currentSection, masterSection]);

        for (const fn of runFns) {
            await fn();
        }

        // Setup validation for any inputs added by passages
        setupInputValidation(currentSectionElement);

        takeDeactivate(currentPassageElement!);
        const pending = takeGoto(currentPassageElement!);
        writeUndoLog();
        save();
        const newCanGoBack = canGoBack();
        if (newCanGoBack != oldCanGoBack) {
            emitter.emit("canGoBackChanged", { canGoBack: newCanGoBack });
        }
        emitter.emit("navigated", { section: get("_section"), passage: passageName });
        await followGoto(pending);
    }
    
    async function processAttributes(attributes: string[]) {
        for (const attribute of attributes) {
            setAttribute(attribute);
        }
    }
    
    function restart() {
        cancelGoto();
        everyTimers.stopAll();
        state.reset();
        sound.sync();
        syncClasses();
        // TODO: This feels like the wrong way of triggering location.reload()
        // - should be a separate setting to the scroll setting.
        if (settings.scroll === "element" || settings.scroll === "none") {
            outputElement.innerHTML = "";
            begin();
        }
        else {
            location.reload();
        }
    }
    
    function save() {
        // TODO: Queue up all attribute changes and save them only when this is called
        // A transition still playing isn't saved, so loading the game doesn't play it again (#489)
        let output = outputElement;
        if (output.querySelector(".squiffy-transition")) {
            output = outputElement.cloneNode(true) as HTMLDivElement;
            output.querySelectorAll<HTMLElement>(".squiffy-transition").forEach(endTransition);
        }
        set("_output", output.innerHTML);
    }
    
    function load() {
        const runUiJs = () => {
            if (story.uiJsIndex !== undefined) {
                runJs(story.uiJsIndex, {
                    registerAnimation: animation.registerAnimation.bind(animation),
                    registerHelper: textProcessor.handlebars.registerHelper.bind(textProcessor.handlebars),
                    SafeString: textProcessor.handlebars.SafeString,
                });
            }
        };

        state.load();
        sound.sync();
        syncClasses();
        const output = get("_output");
        if (!output) {
            runUiJs();
            return false;
        }

        showSavedOutput(output);
        runUiJs();
        pluginManager.onLoad();
        setupInputValidation(currentSectionElement);
        return true;
    }

    // Puts a saved game's text back on screen, and carries on from the end of it
    function showSavedOutput(output: string) {
        // Saved output may contain asset URLs that are no longer valid (e.g. blob: URLs), so resolve them again
        outputElement.innerHTML = resolveAssetsInHtml(output);

        setCurrentSectionElement();
        setCurrentPassageElement();
        currentBlockOutputElement = outputElement.querySelector(".squiffy-output-block:last-child");

        currentSection = story.sections[get("_section")];
    }

    // The game as it is now. The attributes include the text on screen (_output), and the undo
    // log is in that text, so a loaded game can go back too.
    function getSave(): SavedGame {
        return {
            format: "squiffy-save",
            version: 1,
            storyId: story.projectId ?? null,
            section: get("_section"),
            passage: get("_passage"),
            summary: getSummary(),
            savedAt: new Date().toISOString(),
            state: structuredClone(state.store),
        };
    }

    // The start of the text in the current section, to tell saves apart by. If it starts with a
    // heading, that's it, as it's likely to name where the player is.
    function getSummary() {
        const MAX_LENGTH = 100;
        const blocks = currentSectionElement?.querySelectorAll(".squiffy-output-block") ?? [];
        for (const block of blocks) {
            const text = textOf(block);
            if (!text) continue;
            const first = [...block.querySelectorAll("h1, h2, h3, h4, h5, h6, p, li")].find(child => textOf(child));
            if (first && /^H[1-6]$/.test(first.tagName) && textOf(block).startsWith(textOf(first))) {
                return textOf(first).substring(0, MAX_LENGTH);
            }
            if (text.length <= MAX_LENGTH) return text;
            const cut = text.substring(0, MAX_LENGTH);
            const space = cut.lastIndexOf(" ");
            return (space > MAX_LENGTH / 2 ? cut.substring(0, space) : cut) + "…";
        }
        return "";
    }

    // An element's text, with a space between paragraphs, headings and lines
    function textOf(element: Element) {
        const clone = element.cloneNode(true) as Element;
        clone.querySelectorAll("p, h1, h2, h3, h4, h5, h6, li, div, br, tr, blockquote").forEach(el => el.after(" "));
        return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
    }

    function isSavedGame(save: unknown): save is SavedGame {
        if (!save || typeof save != "object") return false;
        const s = save as Partial<SavedGame>;
        return s.format === "squiffy-save" && s.version === 1 && !!s.state && typeof s.state == "object"
            && !Array.isArray(s.state) && typeof s.state._output == "string";
    }

    async function loadSave(save: SavedGame): Promise<LoadSaveResult> {
        if (!isSavedGame(save)) return { success: false, error: "notASave" };
        // A story without an id, or a save from one, can't be checked, so it's loaded
        if (save.storyId && story.projectId && save.storyId !== story.projectId) {
            return { success: false, error: "wrongStory" };
        }

        // Wait for anything being shown to finish, so it doesn't carry on into the loaded game
        while (runningTransitions) {
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        cancelGoto();
        everyTimers.stopAll();
        pendingErrors.length = 0;
        state.reset();
        for (const [attribute, value] of Object.entries(save.state)) {
            state.setInternal(attribute, value, false);
        }
        sound.sync();
        syncClasses();
        undoLog = {};
        scrollPosition = 0;
        scrollToTop = false;
        showSavedOutput(save.state._output as string);

        if (!currentSection) {
            // The section the game was saved in isn't in the story any more, so start again from
            // the beginning, keeping the attributes
            outputElement.innerHTML = "";
            await go(story.start);
            emitter.emit("canGoBackChanged", { canGoBack: canGoBack() });
            return { success: true };
        }

        pluginManager.onLoad();
        setupInputValidation(currentSectionElement);
        emitter.emit("canGoBackChanged", { canGoBack: canGoBack() });
        const passage = get("_passage");
        emitter.emit("navigated", passage ? { section: get("_section"), passage } : { section: get("_section") });

        // Saved while waiting for a {{goto}}, so carry on waiting
        await resumeGoto();
        everyTimers.sync();
        return { success: true };
    }

    function newBlockOutputElement() {
        currentBlockOutputElement = document.createElement("div");
        currentBlockOutputElement.classList.add("squiffy-output-block");
        (currentPassageElement || currentSectionElement)?.appendChild(currentBlockOutputElement);
    }
    
    function newSection(sectionName?: string) {
        if (currentSectionElement) {
            // Inputs we disable are marked with data-squiffy-disabled, so goBack() can re-enable them
            // without touching any that the author disabled themselves.
            currentSectionElement.querySelectorAll("input, textarea, select").forEach(el => {
                const input = el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
                const attribute = input.getAttribute("data-attribute") || input.id;
                if (attribute) set(attribute, input.value);
                if (!input.disabled) {
                    input.disabled = true;
                    input.setAttribute("data-squiffy-disabled", "");
                }
            });

            currentSectionElement.querySelectorAll("[contenteditable]").forEach(el => {
                const attribute = el.getAttribute("data-attribute") || el.id;
                if (attribute) set(attribute, el.innerHTML);
                if (el.getAttribute("contenteditable") !== "false") {
                    el.setAttribute("contenteditable", "false");
                    el.setAttribute("data-squiffy-disabled", "");
                }
            });
        }

        currentPassageElement = null;
        createSectionElement(sectionName);
        newBlockOutputElement();
    }

    function createSectionElement(sectionName?: string) {
        currentSectionElement = document.createElement("div");
        currentSectionElement.classList.add("squiffy-output-section");
        currentSectionElement.setAttribute("data-section", sectionName ?? get("_section"));
        if (!sectionName) {
            currentSectionElement.setAttribute("data-clear", "true");
        }
        outputElement.appendChild(currentSectionElement);
    }

    function getClearStack() {
        return outputElement.querySelector<HTMLElement>(".squiffy-clear-stack");
    }

    function clearScreen() {
        // Callers should call createSectionElement() after calling this function, so there's a place for new
        // output to go. We don't call this automatically within this function, in case we're just about to create
        // a new section anyway.
        let clearStack = getClearStack();
        if (!clearStack) {
            clearStack = document.createElement("div");
            clearStack.classList.add("squiffy-clear-stack");
            clearStack.style.display = "none";
            outputElement.prepend(clearStack);
        }

        const clearStackItem = document.createElement("div");
        clearStack.appendChild(clearStackItem);
        scrollToTop = true;

        // Move everything in the outputElement (except the clearStack itself) into the new clearStackItem
        for (const child of [...outputElement.children]) {
            if (child !== clearStack) {
                clearStackItem.appendChild(child);
            }
        }
        // Without its transitions, so it's as it was if the player goes back to it
        clearStackItem.querySelectorAll<HTMLElement>(".squiffy-transition").forEach(endTransition);

        // NOTE: If we offer an option to disable the "back" feature, all of the above can be replaced with:
        //    outputElement.innerHTML = '';
    }

    // @transition (#489): plays the first transition given, as a class that the stylesheet animates.
    // "none" (or Harlowe's "instant") plays none, so a section can turn off the master section's.
    function startTransition(element: HTMLElement, from: (Section | Passage | undefined)[]) {
        const source = from.find(s => s?.transition);
        const name = source?.transition;
        if (!name || name == "none" || name == "instant") return;
        element.classList.add("squiffy-transition", name);
        element.setAttribute("data-transition", name);
        if (source!.transitionTime !== undefined) {
            element.style.setProperty("--squiffy-transition-time", `${source!.transitionTime}ms`);
        }
        const end = (event: Event) => {
            // A @leave transition started before this one ended takes the element off the screen itself
            if (event.target !== element || element.classList.contains("squiffy-leave")) return;
            element.removeEventListener("animationend", end);
            element.removeEventListener("animationcancel", end);
            endTransition(element);
        };
        element.addEventListener("animationend", end);
        element.addEventListener("animationcancel", end);
    }

    // @leave: plays the first leave transition given on everything on the screen, the arrival
    // transitions backwards, and waits for it to finish, so that clearScreen() can take it away.
    // Links and Back wait too.
    async function leaveTransition(from: (Section | Passage | undefined)[]) {
        const source = from.find(s => s?.leave);
        const name = source?.leave;
        if (!name || name == "none" || name == "instant") return;
        const clearStack = getClearStack();
        const elements = [...outputElement.children].filter((c): c is HTMLElement => c !== clearStack && c instanceof HTMLElement);
        if (!elements.length) return;
        for (const element of elements) {
            endTransition(element);
            element.classList.add("squiffy-transition", "squiffy-leave", name);
            element.setAttribute("data-transition", name);
            if (source!.leaveTime !== undefined) {
                element.style.setProperty("--squiffy-transition-time", `${source!.leaveTime}ms`);
            }
        }
        // Each element plays the same animation, so the first one finishing means they all have
        const first = elements[0];
        const style = getComputedStyle(first);
        if (!style.animationName || style.animationName == "none") return;
        // In case the animation never ends, such as in a page that isn't shown
        const seconds = (value: string) => Math.max(0, ...value.split(",").map(v => parseFloat(v) * (v.trim().endsWith("ms") ? 0.001 : 1) || 0));
        const timeout = (seconds(style.animationDuration) + seconds(style.animationDelay)) * 1000 + 1000;
        const wasRunning = runningTransitions;
        runningTransitions = true;
        try {
            await new Promise<void>(resolve => {
                const timer = setTimeout(done, timeout);
                function done(event?: Event) {
                    if (event && event.target !== first) return;
                    clearTimeout(timer);
                    first.removeEventListener("animationend", done);
                    first.removeEventListener("animationcancel", done);
                    resolve();
                }
                first.addEventListener("animationend", done);
                first.addEventListener("animationcancel", done);
            });
        }
        finally {
            runningTransitions = wasRunning;
        }
    }

    // Takes off a transition's class, so it doesn't play again when the element is shown again,
    // such as after going back past a @clear
    function endTransition(element: HTMLElement) {
        const name = element.getAttribute("data-transition");
        if (name) element.classList.remove(name);
        element.classList.remove("squiffy-transition", "squiffy-leave");
        if (!element.classList.length) element.removeAttribute("class");
        element.removeAttribute("data-transition");
        element.style.removeProperty("--squiffy-transition-time");
        if (!element.getAttribute("style")) element.removeAttribute("style");
    }

    function unClearScreen() {
        const clearStack = getClearStack();
        if (!clearStack) return;
        clearStack.querySelectorAll<HTMLElement>(".squiffy-transition").forEach(endTransition);
        for (const child of [...outputElement.children]) {
            if (child !== clearStack) {
                child.remove();
            }
        }

        const clearStackItem = clearStack.children[clearStack.children.length - 1];
        for (const child of [...clearStackItem.children]) {
            outputElement.appendChild(child);
        }
        clearStackItem.remove();
    }
    
    const ui = {
        write: (text: string, source: string) => {
            scrollPosition = outputElement.scrollHeight;

            const html = pendingErrors.splice(0).join("") + ui.renderHtml(text, false).trim();

            // Previously, we skipped the rest of this if "html" came back as an empty string.
            // But, we _do_ always want the block to be created, in the editor at least - as the
            // author might be in the middle of an edit. When they start writing text for this
            // source (section or passage), we want it to appear in the right place.
            // TODO: What if this comes from a master section/passage though, and there's no
            // text (just a script)? Or if there's conditional text that doesn't display?

            if (!currentBlockOutputElement) {
                newBlockOutputElement();
            }

            const div = document.createElement("div");
            if (source) {
                div.setAttribute("data-source", source);
            }

            div.innerHTML = html;
            pluginManager.onWrite(div);
            currentBlockOutputElement!.appendChild(div);

            // Setup validation for any new inputs that were just added
            setupInputValidation(currentSectionElement);

            ui.scrollToEnd();
        },
        clearScreen: () => {
            clearScreen();
            createSectionElement();
        },
        scrollToEnd: () => {
            if (settings.scroll === "none") {
                // do nothing
            }
            else if (scrollToTop) {
                // The screen was cleared, so the new text starts at the top of the output, which may be
                // above where the reader has scrolled to.
                scrollToTop = false;
                if (settings.scroll === "element") {
                    currentSectionElement.scrollIntoView({ block: "start", inline: "nearest", behavior: "smooth" });
                }
                else {
                    const currentScrollTop = Math.max(document.body.scrollTop, document.documentElement.scrollTop);
                    const outputTop = outputElement.getBoundingClientRect().top + currentScrollTop;
                    if (outputTop < currentScrollTop) {
                        window.scrollTo({ top: outputTop, behavior: "smooth" });
                    }
                }
            }
            else if (settings.scroll === "element") {
                outputElement.lastElementChild?.scrollIntoView({ block: "end", inline: "nearest", behavior: "smooth" });
            }
            else {
                let scrollTo = scrollPosition;
                const currentScrollTop = Math.max(document.body.scrollTop, document.documentElement.scrollTop);
                if (scrollTo > currentScrollTop) {
                    const maxScrollTop = document.documentElement.scrollHeight - window.innerHeight;
                    if (scrollTo > maxScrollTop) scrollTo = maxScrollTop;
                    window.scrollTo({ top: scrollTo, behavior: "smooth" });
                }
            }
        },
        processText: (text: string, inline: boolean) => {
            return textProcessor.process(text, inline);
        },
        // processText, plus asset URL resolution - for text that's going to be displayed as HTML
        renderHtml: (text: string, inline: boolean) => {
            return resolveAssetsInHtml(ui.processText(text, inline));
        },
    };

    function update(newStory: Story) {
        if (newStory.start != story.start) {
            story = newStory;
            state.reset();
            sound.sync();
            syncClasses();
            sound.preload(story.audio ?? []);
            outputElement.innerHTML = "";
            go(story.start);
            return;
        }

        // Switch to the new story before re-rendering, so that text processing (e.g. {{embed}})
        // sees sections that were added in this update.
        const oldStory = story;
        story = newStory;
        // Its settings may have changed
        syncClasses();
        sound.preload(story.audio ?? []);

        // When re-rendering a section or passage, {{embed}} should look up passages in the
        // (new version of the) section being rendered.
        const processTextInSection = (text: string, section: Section) => {
            const previousSection = currentSection;
            currentSection = section;
            // Text shown again after an edit doesn't play its {{sound}}s again
            quiet = true;
            try {
                return ui.renderHtml(text, false);
            } finally {
                currentSection = previousSection;
                quiet = false;
            }
        };

        updateStory(oldStory, newStory, outputElement, processTextInSection, disableLink, (attrs) => processAttributes(attrs));

        setCurrentSectionElement();
        setCurrentPassageElement();
        // The {{#every}}s shown again start again
        everyTimers.sync();
        emitter.emit("storyUpdated", {});
    }

    // A master section passage for a panel or dialog (#14, #443): rendered with the attributes as
    // they are, changing nothing, with its links disabled
    function renderPassage(name: string): string {
        const passage = story.sections[""]?.passages?.[name];
        if (!passage) {
            return errorHtml("Error in panel:", `there is no passage called "${name}" in the master section [[]]`);
        }
        // Anything the story's own text has asked for, which this mustn't change
        const goto = textProcessor.goto;
        const deactivate = [...textProcessor.deactivate];
        state.readOnly = true;
        let html: string;
        try {
            html = ui.renderHtml(passage.text || "", false);
        }
        finally {
            state.readOnly = false;
            textProcessor.goto = goto;
            textProcessor.deactivate = new Set(deactivate);
        }
        const template = document.createElement("template");
        template.innerHTML = html;
        template.content.querySelectorAll("a.squiffy-link").forEach(disableLink);
        return template.innerHTML;
    }

    function setCurrentSectionElement() {
        // Multiple .squiffy-output-section elements may be "last-child" if some have been moved to the clear-stack,
        // so we want the very last one
        const allSectionElements = outputElement.querySelectorAll<HTMLElement>(".squiffy-output-section:last-child");
        currentSectionElement = allSectionElements[allSectionElements.length - 1];
        const sectionName = currentSectionElement.getAttribute("data-section");
        currentSection = story.sections[sectionName!];
    }

    function setCurrentPassageElement() {
        currentPassageElement = currentSectionElement.querySelector(".squiffy-output-passage:last-child");
    }

    function getHistoryCount() {
        const clearStack = getClearStack();
        const sectionPassageCount = outputElement.querySelectorAll(".squiffy-output-section").length
            + outputElement.querySelectorAll(".squiffy-output-passage").length;

        if (!clearStack) {
            return sectionPassageCount;
        }

        return sectionPassageCount + clearStack.children.length;
    }

    function enableInputs(sectionElement: Element) {
        sectionElement.querySelectorAll("[data-squiffy-disabled]").forEach(el => {
            if (el.hasAttribute("contenteditable")) {
                el.setAttribute("contenteditable", "true");
            }
            else {
                (el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).disabled = false;
            }
            el.removeAttribute("data-squiffy-disabled");
        });
    }

    function canGoBack() {
        // Sections and passages that went somewhere else with {{goto}} are skipped by goBack(), so
        // they don't count, unless it's the current one, still waiting for its after= delay
        const current = currentPassageElement ?? currentSectionElement;
        const redirected = [...outputElement.querySelectorAll("[data-goto]")].filter(el => el !== current).length;
        return getHistoryCount() - redirected > 1;
    }

    function goBack() {
        // Like link clicks, ignore this while transitions are running. The section or passage being shown
        // hasn't written its undo log yet, and would write it to the wrong element once it resumed.
        if (runningTransitions || !canGoBack()) {
            return;
        }

        cancelGoto();
        // Undo back to the section or passage the player clicked through to, not one that went
        // somewhere else with {{goto}}
        do {
            undoLast();
        } while ((currentPassageElement ?? currentSectionElement).hasAttribute("data-goto") && getHistoryCount() > 1);
        // The music goes back to what it was, as _music was undone
        sound.sync();
        syncClasses();
        // The attributes were saved as they were undone, so save the output to match. Otherwise a saved
        // game would come back with the text that was undone.
        save();

        if (!canGoBack()) {
            emitter.emit("canGoBackChanged", { canGoBack: false });
        }
        const passage = currentPassageElement?.getAttribute("data-passage");
        emitter.emit("navigated", passage ? { section: get("_section"), passage } : { section: get("_section") });
        // The {{#every}}s that were undone stop, and any in the section gone back to start again
        everyTimers.sync();
    }

    function undoLast() {
        const clearStack = getClearStack();

        if (currentPassageElement) {
            const currentPassage = currentPassageElement.getAttribute("data-passage");
            const clicked = currentPassageElement.getAttribute("data-clicked-link");
            doUndo(currentPassageElement.getAttribute("data-undo"));
            undoDeactivate(currentPassageElement);
            currentPassageElement.remove();

            // If there's nothing left in the outputElement except for an empty section element that
            // was created when the screen was cleared, pop the clear-stack.

            let hasEmptySection = false;
            let hasOtherElements = false;
            for (const child of outputElement.children) {
                if (child === clearStack) {
                    continue;
                }
                if (child.getAttribute("data-clear") == "true" && child.children.length == 0) {
                    hasEmptySection = true;
                    continue;
                }
                hasOtherElements = true;
                break;
            }

            if (hasEmptySection && !hasOtherElements) {
                unClearScreen();
                setCurrentSectionElement();
            }

            if (clicked) {
                for (const link of currentSectionElement.querySelectorAll(`a.squiffy-link[data-clicked="${clicked}"], input[data-clicked="${clicked}"]`)) {
                    enableLink(link);
                    link.removeAttribute("data-clicked");
                }
            }
            else if (currentPassage && !isRepeatPassage(currentPassage)) {
                // Saved before links were numbered when clicked, so enable every link to the passage
                for (const link of currentSectionElement.querySelectorAll("a.squiffy-link[data-passage]")) {
                    if (link.getAttribute("data-passage") == currentPassage) {
                        enableLink(link);
                    }
                }
            }

            setCurrentPassageElement();
        }
        else {
            doUndo(currentSectionElement.getAttribute("data-undo"));
            currentSectionElement.remove();

            // If there's nothing left in the outputElement except for the clear-stack, pop it
            let hasOtherElements = false;
            for (const child of [...outputElement.children]) {
                if (child === clearStack) {
                    continue;
                }
                hasOtherElements = true;
                break;
            }

            if (!hasOtherElements) {
                unClearScreen();
            }

            setCurrentSectionElement();
            setCurrentPassageElement();
            enableInputs(currentSectionElement);
        }
    }

    // We create a separate div inside the passed-in element. This allows us to clear the text output, but
    // without affecting any overlays that may have been added to the container (for transitions).
    const outputElementContainer = options.element;
    const outputElement = document.createElement("div");
    outputElementContainer.appendChild(outputElement);
    story = options.story;
    const resolveAssetsInHtml = createAssetHtmlResolver(options.resolveAssetUrl);

    const settings = {
        scroll: options.scroll || "body",
        persist: (options.persist === undefined) ? true : options.persist,
        onSet: options.onSet || (() => {})
    };

    // Determine the storage key to use for localStorage
    let storageKey = "";
    if (settings.persist) {
        if (options.storyId !== undefined) {
            // Use explicit storyId if provided
            storageKey = options.storyId;
        } else if (window.location.protocol === "file:") {
            // For games opened from file system, use story.id (a GUID generated at compile time)
            // This prevents issues with file:// localStorage sharing in Chrome
            storageKey = story.id || "";
        } else {
            // For games served via HTTP(S), use the URL path
            storageKey = window.location.pathname;
        }

        if (!storageKey) {
            console.warn("Persist is set to true in Squiffy runtime options, but no storage key could be determined. Persist will be disabled.");
            settings.persist = false;
        }
    }

    if (settings.scroll === "element") {
        outputElement.style.overflowY = "auto";
    }

    outputElement.addEventListener("click", handleClick);
    outputElement.addEventListener("keypress", async function (event) {
        if (event.key !== "Enter") return;
        const target = event.target;
        // A text box with data-section or data-passage goes there when Enter is pressed (#454),
        // like a link, once every text box in the section is filled in properly
        if (target instanceof window.HTMLInputElement && (target.hasAttribute("data-section") || target.hasAttribute("data-passage"))) {
            if (event.isComposing) return;
            event.preventDefault();
            if (!areInputsValid(currentSectionElement)) {
                // Shows which ones need filling in
                for (const input of currentSectionElement.querySelectorAll<HTMLInputElement>("input:not([disabled]), textarea:not([disabled]), select:not([disabled])")) {
                    input.reportValidity();
                }
                return;
            }
            await handleLink(target);
            return;
        }
        await handleClick(event);
    });

    let undoLog: Record<string, any> = {};

    const onSet = function(attribute: string, oldValue: any) {
        if (attribute == "_output") return;
        if (attribute in undoLog) return;
        undoLog[attribute] = oldValue;
    };

    const writeUndoLog = function() {
        (currentPassageElement ?? currentSectionElement).setAttribute("data-undo", JSON.stringify(undoLog));
        undoLog = {};
    };

    // Adds what's changed since to the undo log of the section or passage already shown, keeping
    // the value from before it was shown, e.g. for an {{#every}}'s text (#451)
    const mergeUndoLog = function() {
        const element = currentPassageElement ?? currentSectionElement;
        const log = JSON.parse(element.getAttribute("data-undo") || "{}");
        for (const [attribute, value] of Object.entries(undoLog)) {
            if (!(attribute in log)) log[attribute] = value;
        }
        element.setAttribute("data-undo", JSON.stringify(log));
        undoLog = {};
    };

    // Shows an {{#every}}'s text again (#451). Returns false if it has to wait, while a section or
    // passage is being shown.
    function tickEvery(el: HTMLElement): boolean {
        if (runningTransitions || navigating > 0) return false;
        const inline = el.tagName == "SPAN";
        const body = decodeURIComponent(el.getAttribute("data-every") || "");
        let html: string;
        textProcessor.stopEvery = false;
        try {
            html = ui.renderHtml(body, inline);
            // Text added after text keeps its spaces, e.g. {{#every 1000 append=true}}Drip. {{/every}}
            if (inline) html = (/^\s/.test(body) ? " " : "") + html + (/\s$/.test(body) ? " " : "");
        }
        catch (e) {
            html = errorHtml("Error in {{#every}}:", e instanceof Error ? e.message : String(e));
            textProcessor.stopEvery = true;
        }
        const text = document.createElement(inline ? "span" : "div");
        text.className = "squiffy-every-text";
        text.innerHTML = html;
        if (el.hasAttribute("data-every-append")) el.append(text);
        else el.replaceChildren(text);
        pluginManager.onWrite(text);

        const count = (Number(el.getAttribute("data-every-count")) || 0) + 1;
        el.setAttribute("data-every-count", String(count));
        const times = Number(el.getAttribute("data-every-times")) || 0;
        if (textProcessor.stopEvery || (times && count >= times)) el.setAttribute("data-every-stopped", "");
        textProcessor.stopEvery = false;

        const element = currentPassageElement ?? currentSectionElement;
        takeDeactivate(element);
        const pending = takeGoto(element);
        mergeUndoLog();
        save();
        if (pending) {
            // It replaces any {{goto ... after=}} still waiting
            clearTimeout(gotoTimer);
            gotoHops = 0;
            void followGoto(pending);
        }
        return true;
    }

    const doUndo = function(undosJson: string | null) {
        if (!undosJson) return;
        const undos = JSON.parse(undosJson) as Record<string, any>;
        if (!undos) return;
        for (const attribute of Object.keys(undos)) {
            state.setInternal(attribute, undos[attribute], false);
        }
    };

    const state = new State(settings.persist, storageKey, settings.onSet, emitter, onSet);
    const get = state.get.bind(state);
    const set = state.set.bind(state);

    // The player's settings (#452), which the story reads as settings.name
    const playerSettings = new PlayerSettings(() => story.settings ?? [], settings.persist ? "squiffy-settings:" + storageKey : undefined);
    state.playerSettings = () => playerSettings.any() ? playerSettings.all() : null;
    // After a setting changes: its classes, and text that shows it, such as {{live "settings"}} and panels
    const settingChanged = (name: string, value: unknown) => {
        syncClasses();
        emitter.emit("settingChanged", { name, value });
        emitter.emit("set", { attribute: "settings", value: playerSettings.all() });
    };

    const textProcessor = new TextProcessor(() => story, state, () => currentSection);
    const strings = options.strings ?? {};
    if (typeof strings.restart == "string") textProcessor.strings.restart = strings.restart;
    if (typeof strings.saves == "string") textProcessor.strings.saves = strings.saves;
    if (typeof strings.settings == "string") textProcessor.strings.settings = strings.settings;

    // Music and sound effects (#444)
    let playedSound = false;
    // While text is shown again rather than for the first time, {{sound}} doesn't play
    let quiet = false;
    // How long the next change to _music fades for: fade= on {{music}} or {{stopmusic}}
    let musicFade = DEFAULT_FADE;
    const sound = new Sound({
        resolveUrl: path => isAbsolute(path) || !options.resolveAssetUrl
            ? path
            : options.resolveAssetUrl(path.replace(/^(\.\/)+/, "")),
        getMusic: () => get("_music"),
        mutedKey: settings.persist ? "squiffy-muted:" + storageKey : undefined,
        onPlay: () => {
            playedSound = true;
            emitter.emit("sound", {});
        },
    });
    sound.preload(story.audio ?? []);
    emitter.on("set", ({ attribute }) => {
        if (attribute != "_music") return;
        const fade = musicFade;
        musicFade = DEFAULT_FADE;
        sound.sync(fade);
    });
    const fadeOption = (options: { hash?: Record<string, unknown> } | undefined) => {
        const fade = Number(options?.hash?.fade);
        return options?.hash && "fade" in options.hash && Number.isFinite(fade) && fade >= 0 ? fade : DEFAULT_FADE;
    };
    // {{music}} and {{sound}} with nothing after them are still an attribute called music or
    // sound, as they were before these helpers
    const isHelperOptions = (value: unknown) => typeof value == "object" && value !== null && "hash" in value;
    textProcessor.handlebars.registerHelper("music", (file: unknown, options?: { hash?: Record<string, unknown> }) => {
        if (isHelperOptions(file)) return get("music");
        if (state.readOnly || typeof file != "string") return "";
        musicFade = fadeOption(options);
        set("_music", file || null);
        musicFade = DEFAULT_FADE;
        return "";
    });
    textProcessor.handlebars.registerHelper("stopmusic", (options?: { hash?: Record<string, unknown> }) => {
        if (state.readOnly) return "";
        musicFade = fadeOption(options);
        set("_music", null);
        musicFade = DEFAULT_FADE;
        return "";
    });
    textProcessor.handlebars.registerHelper("sound", (file: unknown, options?: { hash?: Record<string, unknown> }) => {
        if (isHelperOptions(file)) return get("sound");
        if (state.readOnly || quiet || typeof file != "string" || !file) return "";
        const volume = Number(options?.hash?.volume ?? 1);
        sound.play(file, volume);
        return "";
    });
    textProcessor.handlebars.registerHelper("stopsounds", () => {
        if (!state.readOnly && !quiet) sound.stopSounds();
        return "";
    });

    // Classes on the story's element (#449): the current section's, from @class, which change with
    // the section, and ones from {{addclass}}, which stay until they're removed. They're attributes,
    // so they come back with Back and saved games.
    const SECTION_CLASSES = "_sectionclasses";
    const CLASSES = "_classes";
    // The classes this put on the element, so it leaves any others alone
    let appliedClasses: string[] = [];
    const classList = (attribute: string): string[] => {
        const value = get(attribute);
        return Array.isArray(value) ? value.filter((c): c is string => typeof c == "string" && c.length > 0) : [];
    };
    const sectionClasses = () => classList(SECTION_CLASSES);
    // Class names from helper arguments, which can each hold several separated by spaces
    const classNames = (values: unknown[]) => values
        .filter(v => !isHelperOptions(v))
        .flatMap(v => String(v ?? "").split(/\s+/))
        .filter(c => c.length > 0);
    function setSectionClasses(classes: string[]) {
        const unique = [...new Set(classes)];
        const current = sectionClasses();
        if (unique.length == current.length && unique.every((c, i) => c == current[i])) return;
        set(SECTION_CLASSES, unique);
    }
    function applyClasses(classes: string[]) {
        for (const c of appliedClasses) {
            if (!classes.includes(c)) outputElementContainer.classList.remove(c);
        }
        for (const c of classes) outputElementContainer.classList.add(c);
        appliedClasses = classes;
    }
    // With the classes from the player's settings, such as setting-textSize-Large
    function syncClasses() {
        applyClasses([...new Set([...sectionClasses(), ...classList(CLASSES), ...playerSettings.classes()])]);
    }
    emitter.on("set", ({ attribute }) => {
        if (attribute == SECTION_CLASSES || attribute == CLASSES) syncClasses();
    });
    textProcessor.handlebars.registerHelper("addclass", (...args: unknown[]) => {
        if (state.readOnly) return "";
        const classes = classList(CLASSES);
        const added = classNames(args).filter(c => !classes.includes(c));
        if (added.length) set(CLASSES, [...classes, ...added]);
        return "";
    });
    textProcessor.handlebars.registerHelper("removeclass", (...args: unknown[]) => {
        if (state.readOnly) return "";
        const removed = classNames(args);
        const classes = classList(CLASSES);
        if (classes.some(c => removed.includes(c))) set(CLASSES, classes.filter(c => !removed.includes(c)));
        return "";
    });
    textProcessor.handlebars.registerHelper("toggleclass", (...args: unknown[]) => {
        if (state.readOnly) return "";
        let classes = classList(CLASSES);
        for (const c of new Set(classNames(args))) {
            classes = classes.includes(c) ? classes.filter(x => x != c) : [...classes, c];
        }
        set(CLASSES, classes);
        return "";
    });
    // Whether the story's element has all these classes, from @class or {{addclass}}
    textProcessor.handlebars.registerHelper("hasclass", (...args: unknown[]) => {
        const names = classNames(args);
        const classes = [...sectionClasses(), ...classList(CLASSES)];
        return names.length > 0 && names.every(c => classes.includes(c));
    });

    const linkHandler = new LinkHandler();

    // {{restart}} and {{saves}} links (#452). The page can handle them itself, with its own
    // dialogs, by listening for restartRequested and savesRequested. Otherwise the runtime asks
    // before restarting, and opens a Saved games dialog of its own.
    let savesDialog: SavesDialog | null = null;
    linkHandler.registerLinkHandler("restart", link => {
        const confirm = link.getAttribute("data-confirm") !== "false";
        // After the click has been handled, which saves the game as it is
        queueMicrotask(async () => {
            if (emitter.has("restartRequested")) {
                emitter.emit("restartRequested", { confirm });
                return;
            }
            if (confirm && !await confirmDialog({
                message: strings.restartConfirm ?? "Are you sure you want to restart?",
                confirm: strings.restart ?? "Restart",
                cancel: strings.cancel,
            })) return;
            restart();
        });
        return {};
    });
    let settingsDialog: SettingsDialog | null = null;
    linkHandler.registerLinkHandler("settings", () => {
        if (emitter.has("settingsRequested")) {
            emitter.emit("settingsRequested", {});
        }
        else {
            settingsDialog ??= createSettingsDialog(api, { strings });
            settingsDialog.open();
        }
        return {};
    });
    linkHandler.registerLinkHandler("saves", () => {
        if (emitter.has("savesRequested")) {
            emitter.emit("savesRequested", {});
        }
        else {
            savesDialog ??= createSavesDialog(api, { strings });
            savesDialog.open();
        }
        return {};
    });

    const getSectionText = (sectionName: string) => {
        if (sectionName in story.sections) {
            return story.sections[sectionName].text || null;
        }
        return null;
    };

    const getPassageText = (name: string) => {
        if (currentSection.passages && name in currentSection.passages) {
            return currentSection.passages[name].text || null;
        } else if ("passages" in story.sections[""] && story.sections[""].passages && name in story.sections[""].passages) {
            return story.sections[""].passages![name].text || null;
        }
        return null;
    };

    const addTransition = (fn: () => Promise<void>) => {
        transitions.push(fn);
    };

    const animation = new Animation();

    const pluginManager = new PluginManager(outputElement, textProcessor, state, linkHandler,
        getSectionText, getPassageText, ui.renderHtml, addTransition, animation, emitter, resolveAssetsInHtml);
    pluginManager.add(Plugins.ReplaceLabel());
    pluginManager.add(Plugins.RotateSequencePlugin());
    pluginManager.add(Plugins.RandomPlugin());
    pluginManager.add(Plugins.LivePlugin());
    pluginManager.add(Plugins.AnimatePlugin());

    const api: SquiffyApi = {
        begin: begin,
        restart: restart,
        get: get,
        set: set,
        clickLink: handleLink,
        update: update,
        goBack: goBack,
        canGoBack: canGoBack,
        getSave: getSave,
        loadSave: loadSave,
        renderPassage: renderPassage,
        isMuted: () => sound.isMuted(),
        setMuted: (muted: boolean) => sound.setMuted(muted),
        usesSound: () => playedSound || !!story.audio?.length,
        getSettings: () => structuredClone(playerSettings.definitions()),
        getSetting: (name: string) => playerSettings.get(name),
        setSetting: (name, value) => {
            if (playerSettings.set(name, value)) settingChanged(name, playerSettings.get(name));
        },
        resetSettings: () => {
            const before = playerSettings.all();
            playerSettings.reset();
            for (const [name, value] of Object.entries(playerSettings.all())) {
                if (value !== before[name]) settingChanged(name, value);
            }
        },
        dispose: () => {
            cancelGoto();
            everyTimers.stopAll();
            sound.dispose();
            applyClasses([]);
            savesDialog?.element.remove();
            settingsDialog?.element.remove();
        },
        on: (e, h) => emitter.on(e, h),
        off: (e, h) => emitter.off(e, h),
        once: (e, h) => emitter.once(e, h),
    };
    return api;
};