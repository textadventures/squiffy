import { SquiffyApi, SquiffyInitOptions, Story, Section, Passage } from "./types.js";
import { TextProcessor } from "./textProcessor.js";
import { Emitter, SquiffyEventMap } from "./events.js";
import { State } from "./state.js";
import { updateStory } from "./updater.js";
import { PluginManager } from "./pluginManager.js";
import { Plugins } from "./plugins/index.js";
import { LinkHandler } from "./linkHandler.js";
import { Animation } from "./animation.js";
import { imports } from "./import.js";
import { areInputsValid, setupInputValidation } from "./inputValidation.js";

export type { SquiffyApi } from "./types.js";

export const init = async (options: SquiffyInitOptions): Promise<SquiffyApi> => {
    let story: Story;
    let currentSection: Section;
    let currentSectionElement: HTMLElement;
    let currentPassageElement: HTMLElement;
    let currentBlockOutputElement: HTMLElement;
    let scrollPosition = 0;
    const emitter = new Emitter<SquiffyEventMap>();
    const transitions: (() => Promise<void>)[] = [];
    let runningTransitions = false;

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

        if (passage !== null) {
            disableLink(link);
            set("_turncount", get("_turncount") + 1);
            await processLink(link);
            if (passage) {
                currentBlockOutputElement = null;
                await showPassage(passage);
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
    
    function disableLink(link: Element) {
        link.classList.add("disabled");
        link.setAttribute("tabindex", "-1");
    }

    function enableLink(link: Element) {
        link.classList.remove("disabled");
        link.removeAttribute("tabindex");
    }
    
    async function begin() {
        if (!load()) {
            await go(story.start);
        }
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
    
    function setAttribute(expr: string) {
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
                let rhs = incDecMatch[3];
                if (rhs.startsWith("@")) rhs = get(rhs.substring(1));
                const rhsNumeric = parseFloat(rhs);
                let value = get(lhs);
                if (value === null) value = 0;
                if (op == "+") {
                    value += rhsNumeric;
                }
                if (op == "-") {
                    value -= rhsNumeric;
                }
                if (op == "*") {
                    value *= rhsNumeric;
                }
                if (op == "/") {
                    value /= rhsNumeric;
                }
                set(lhs, value);
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
        const oldCanGoBack = canGoBack();
        currentSection = story.sections[sectionName];
        if (!currentSection) return;
        set("_section", sectionName);
        state.setSeen(sectionName);
        const master = story.sections[""];
        if (master?.clear || currentSection.clear) {
            clearScreen();
        }
        newSection(sectionName);
        if (master) {
            await run(master, "[[]]");
        }
        await run(currentSection, `[[${sectionName}]]`);
        // The JS might have changed which section we're in
        if (get("_section") == sectionName) {
            set("_turncount", 0);
            writeUndoLog();
            save();
        }
        const newCanGoBack = canGoBack();
        if (newCanGoBack != oldCanGoBack) {
            emitter.emit("canGoBackChanged", { canGoBack: newCanGoBack });
        }
    }

    function runJs(index: number, extra: any = null) {
        const squiffy = {
            get: get,
            set: set,
            ui: {
                transition: addTransition,
                write: ui.write,
                scrollToEnd: ui.scrollToEnd,
            },
            story: {
                go: go,
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
        if (section.jsIndex !== undefined) {
            runJs(section.jsIndex);
        }

        ui.write(section.text || "", source);

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
    
    async function showPassage(passageName: string) {
        const oldCanGoBack = canGoBack();
        let passage = currentSection.passages && currentSection.passages[passageName];
        const masterSection = story.sections[""];
        if (!passage && masterSection && masterSection.passages) passage = masterSection.passages[passageName];
        if (!passage) {
            throw `No passage named ${passageName} in the current section or master section`;
        }
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
        if (currentSection.passages) {
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

        if (passages.some(p => p.clear)) {
            clearScreen();
            createSectionElement();
        }

        currentPassageElement = document.createElement("div");
        currentPassageElement.classList.add("squiffy-output-passage");
        currentPassageElement.setAttribute("data-passage", `${passageName}`);

        currentSectionElement.appendChild(currentPassageElement);

        for (const fn of runFns) {
            await fn();
        }

        // Setup validation for any inputs added by passages
        setupInputValidation(currentSectionElement);

        writeUndoLog();
        save();
        const newCanGoBack = canGoBack();
        if (newCanGoBack != oldCanGoBack) {
            emitter.emit("canGoBackChanged", { canGoBack: newCanGoBack });
        }
    }
    
    async function processAttributes(attributes: string[]) {
        for (const attribute of attributes) {
            setAttribute(attribute);
        }
    }
    
    function restart() {
        state.reset();
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
        set("_output", outputElement.innerHTML);
    }
    
    function load() {
        const runUiJs = () => {
            if (story.uiJsIndex !== undefined) {
                runJs(story.uiJsIndex, {
                    registerAnimation: animation.registerAnimation.bind(animation),
                });
            }
        };

        state.load();
        const output = get("_output");
        if (!output) {
            runUiJs();
            return false;
        }

        outputElement.innerHTML = output;

        setCurrentSectionElement();
        setCurrentPassageElement();
        currentBlockOutputElement = outputElement.querySelector(".squiffy-output-block:last-child");

        currentSection = story.sections[get("_section")];
        runUiJs();
        pluginManager.onLoad();
        setupInputValidation(currentSectionElement);
        return true;
    }

    function newBlockOutputElement() {
        currentBlockOutputElement = document.createElement("div");
        currentBlockOutputElement.classList.add("squiffy-output-block");
        (currentPassageElement || currentSectionElement)?.appendChild(currentBlockOutputElement);
    }
    
    function newSection(sectionName?: string) {
        if (currentSectionElement) {
            currentSectionElement.querySelectorAll("input").forEach(el => {
                const attribute = el.getAttribute("data-attribute") || el.id;
                if (attribute) set(attribute, el.value);
                el.disabled = true;
            });
    
            currentSectionElement.querySelectorAll("[contenteditable]").forEach(el => {
                const attribute = el.getAttribute("data-attribute") || el.id;
                if (attribute) set(attribute, el.innerHTML);
                (el as HTMLElement).contentEditable = "false";
            });
    
            currentSectionElement.querySelectorAll("textarea").forEach(el => {
                const attribute = el.getAttribute("data-attribute") || el.id;
                if (attribute) set(attribute, el.value);
                el.disabled = true;
            });

            currentSectionElement.querySelectorAll("select").forEach(el => {
                const attribute = el.getAttribute("data-attribute") || el.id;
                if (attribute) set(attribute, el.value);
                el.disabled = true;
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

        // Move everything in the outputElement (except the clearStack itself) into the new clearStackItem
        for (const child of [...outputElement.children]) {
            if (child !== clearStack) {
                clearStackItem.appendChild(child);
            }
        }

        // NOTE: If we offer an option to disable the "back" feature, all of the above can be replaced with:
        //    outputElement.innerHTML = '';
    }

    function unClearScreen() {
        const clearStack = getClearStack();
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

            const html = ui.processText(text, false).trim();

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
            currentBlockOutputElement.appendChild(div);

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
            else if (settings.scroll === "element") {
                outputElement.lastElementChild.scrollIntoView({ block: "end", inline: "nearest", behavior: "smooth" });
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
    };

    function update(newStory: Story) {
        if (newStory.start != story.start) {
            story = newStory;
            state.reset();
            outputElement.innerHTML = "";
            go(story.start);
            return;
        }

        updateStory(story, newStory, outputElement, ui, disableLink, (attrs) => processAttributes(attrs));

        story = newStory;

        setCurrentSectionElement();
        setCurrentPassageElement();
    }

    function setCurrentSectionElement() {
        // Multiple .squiffy-output-section elements may be "last-child" if some have been moved to the clear-stack,
        // so we want the very last one
        const allSectionElements = outputElement.querySelectorAll<HTMLElement>(".squiffy-output-section:last-child");
        currentSectionElement = allSectionElements[allSectionElements.length - 1];
        const sectionName = currentSectionElement.getAttribute("data-section");
        currentSection = story.sections[sectionName];
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

    function canGoBack() {
        return getHistoryCount() > 1;
    }

    function goBack() {
        if (!canGoBack()) {
            return;
        }

        const clearStack = getClearStack();

        if (currentPassageElement) {
            const currentPassage = currentPassageElement.getAttribute("data-passage");
            doUndo(currentPassageElement.getAttribute("data-undo"));
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

            for (const link of currentSectionElement.querySelectorAll("a.squiffy-link[data-passage]")) {
                if (link.getAttribute("data-passage") == currentPassage) {
                    enableLink(link);
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
        }

        if (!canGoBack()) {
            emitter.emit("canGoBackChanged", { canGoBack: false });
        }
    }

    // We create a separate div inside the passed-in element. This allows us to clear the text output, but
    // without affecting any overlays that may have been added to the container (for transitions).
    const outputElementContainer = options.element;
    const outputElement = document.createElement("div");
    outputElementContainer.appendChild(outputElement);
    story = options.story;

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

    const textProcessor = new TextProcessor(story, state, () => currentSection);
    const linkHandler = new LinkHandler();

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
        getSectionText, getPassageText, ui.processText, addTransition, animation, emitter);
    pluginManager.add(Plugins.ReplaceLabel());
    pluginManager.add(Plugins.RotateSequencePlugin());
    pluginManager.add(Plugins.RandomPlugin());
    pluginManager.add(Plugins.LivePlugin());
    pluginManager.add(Plugins.AnimatePlugin());

    return {
        begin: begin,
        restart: restart,
        get: get,
        set: set,
        clickLink: handleLink,
        update: update,
        goBack: goBack,
        on: (e, h) => emitter.on(e, h),
        off: (e, h) => emitter.off(e, h),
        once: (e, h) => emitter.once(e, h),
    };
};