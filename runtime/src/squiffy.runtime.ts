import { SquiffyApi, SquiffyInitOptions, SquiffySettings, Story, Section } from './types.js';
import { TextProcessor } from './textProcessor.js';
import { Emitter, SquiffyEventMap } from './events.js';
import { State } from "./state.js";
import { updateStory } from "./updater.js";
import {PluginManager} from "./pluginManager.js";
import {Plugins} from "./plugins/index.js";
import {LinkHandler} from "./linkHandler.js";
import {Animation} from "./animation.js";
import {imports} from "./import.js";

export type { SquiffyApi } from "./types.js"

export const init = async (options: SquiffyInitOptions): Promise<SquiffyApi> => {
    let story: Story;
    let currentSection: Section;
    let currentSectionElement: HTMLElement;
    let currentBlockOutputElement: HTMLElement;
    let scrollPosition = 0;
    let outputElement: HTMLElement;
    let outputElementContainer: HTMLElement;
    let settings: SquiffySettings;
    let state: State;
    let textProcessor: TextProcessor;
    let linkHandler: LinkHandler;
    let pluginManager: PluginManager;
    let animation: Animation;
    const emitter = new Emitter<SquiffyEventMap>();
    const transitions: (() => Promise<void>)[] = [];
    let runningTransitions = false;
    
    async function handleLink(link: HTMLElement): Promise<boolean> {
        if (runningTransitions) return false;
        const outputSection = link.closest('.squiffy-output-section');
        if (outputSection !== currentSectionElement) return false;

        if (link.classList.contains('disabled')) return false;

        let passage = link.getAttribute('data-passage');
        let section = link.getAttribute('data-section');

        if (passage !== null) {
            disableLink(link);
            set('_turncount', get('_turncount') + 1);
            await processLink(link);
            if (passage) {
                currentBlockOutputElement = null;
                await showPassage(passage);
            }
            const turnPassage = '@' + get('_turncount');
            if (currentSection.passages) {
                if (turnPassage in currentSection.passages) {
                    await showPassage(turnPassage);
                }
                if ('@last' in currentSection.passages && get('_turncount') >= (currentSection.passageCount || 0)) {
                    await showPassage('@last');
                }
            }

            emitter.emit('linkClick', { linkType: 'passage' });
            return true;
        }
        
        if (section !== null) {
            await processLink(link);
            if (section) {
                await go(section);
            }

            emitter.emit('linkClick', { linkType: 'section' });
            return true;
        }

        const [handled, type, result] = linkHandler.handleLink(link);
        
        if (handled) {
            if (result?.disableLink) {
                disableLink(link);
            }

            save();

            emitter.emit('linkClick', { linkType: type });
            return true;
        }

        return false;
    }

    async function handleClick(event: Event) {
        const target = event.target as HTMLElement;
        if (target.classList.contains('squiffy-link')) {
            await handleLink(target);
        }
    }
    
    function disableLink(link: Element) {
        link.classList.add('disabled');
        link.setAttribute('tabindex', '-1');
    }
    
    async function begin() {
        if (!load()) {
            await go(story.start);
        }
    }
    
    async function processLink(link: HTMLElement) {
        animation.runLinkAnimation(link);
        await runTransitions();
        const settersJson = link.getAttribute('data-set');
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
            let rhs = setMatch[2];
            if (isNaN(rhs as any)) {
                if (rhs.startsWith("@")) rhs = get(rhs.substring(1));
                set(lhs, rhs);
            }
            else {
                set(lhs, parseFloat(rhs));
            }
        }
        else {
            const incDecRegex = /^([\w]*)\s*([\+\-\*\/])=\s*(.*)$/;
            const incDecMatch = incDecRegex.exec(expr);
            if (incDecMatch) {
                const lhs = incDecMatch[1];
                const op = incDecMatch[2];
                let rhs = incDecMatch[3];
                if (rhs.startsWith("@")) rhs = get(rhs.substring(1));
                const rhsNumeric = parseFloat(rhs);
                let value = get(lhs);
                if (value === null) value = 0;
                if (op == '+') {
                    value += rhsNumeric;
                }
                if (op == '-') {
                    value -= rhsNumeric;
                }
                if (op == '*') {
                    value *= rhsNumeric;
                }
                if (op == '/') {
                    value /= rhsNumeric;
                }
                set(lhs, value);
            }
            else {
                let value = true;
                if (expr.startsWith('not ')) {
                    expr = expr.substring(4);
                    value = false;
                }
                set(expr, value);
            }
        }
    }

    async function go(sectionName: string) {
        newSection(sectionName);
        currentSection = story.sections[sectionName];
        if (!currentSection) return;
        set('_section', sectionName);
        state.setSeen(sectionName);
        const master = story.sections[''];
        if (master) {
            await run(master, "[[]]");
        }
        await run(currentSection, `[[${sectionName}]]`);
        // The JS might have changed which section we're in
        if (get('_section') == sectionName) {
            set('_turncount', 0);
            save();
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
        if (section.clear) {
            ui.clearScreen();
        }
        if (section.attributes) {
            await processAttributes(section.attributes);
        }
        if (section.jsIndex !== undefined) {
            runJs(section.jsIndex);
        }

        ui.write(section.text || '', source);

        await runTransitions();
    }

    async function runTransitions() {
        runningTransitions = true;
        currentSectionElement.classList.add('links-disabled');
        for (const transition of transitions) {
            await transition();
        }
        transitions.length = 0;
        runningTransitions = false;
        currentSectionElement.classList.remove('links-disabled');
    }
    
    async function showPassage(passageName: string) {
        let passage = currentSection.passages && currentSection.passages[passageName];
        const masterSection = story.sections[''];
        if (!passage && masterSection && masterSection.passages) passage = masterSection.passages[passageName];
        if (!passage) {
            throw `No passage named ${passageName} in the current section or master section`;
        }
        state.setSeen(passageName);
        if (masterSection && masterSection.passages) {
            const masterPassage = masterSection.passages[''];
            if (masterPassage) {
                await run(masterPassage, `[[]][]`);
            }
        }
        const master = currentSection.passages && currentSection.passages[''];
        if (master) {
            await run(master, `[[${get("_section")}]][]`);
        }
        await run(passage, `[[${get("_section")}]][${passageName}]`);
        save();
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
        if (settings.scroll === 'element' || settings.scroll === 'none') {
            outputElement.innerHTML = '';
            begin();
        }
        else {
            location.reload();
        }
    }
    
    function save() {
        // TODO: Queue up all attribute changes and save them only when this is called
        set('_output', outputElement.innerHTML);
    }
    
    function load() {
        const runUiJs = () => {
            if (story.uiJsIndex !== undefined) {
                runJs(story.uiJsIndex, {
                    registerAnimation: animation.registerAnimation.bind(animation),
                });
            }
        }

        state.load();
        const output = get('_output');
        if (!output) {
            runUiJs();
            return false;
        }

        outputElement.innerHTML = output;

        currentSectionElement = outputElement.querySelector('.squiffy-output-section:last-child');
        currentBlockOutputElement = outputElement.querySelector('.squiffy-output-block:last-child');

        currentSection = story.sections[get('_section')];
        runUiJs();
        pluginManager.onLoad();
        return true;
    }

    function newBlockOutputElement() {
        currentBlockOutputElement = document.createElement('div');
        currentBlockOutputElement.classList.add('squiffy-output-block');
        currentSectionElement?.appendChild(currentBlockOutputElement);
    }
    
    function newSection(sectionName: string | null) {
        if (currentSectionElement) {
            currentSectionElement.querySelectorAll('input').forEach(el => {
                const attribute = el.getAttribute('data-attribute') || el.id;
                if (attribute) set(attribute, el.value);
                el.disabled = true;
            });
    
            currentSectionElement.querySelectorAll("[contenteditable]").forEach(el => {
                const attribute = el.getAttribute('data-attribute') || el.id;
                if (attribute) set(attribute, el.innerHTML);
                (el as HTMLElement).contentEditable = 'false';
            });
    
            currentSectionElement.querySelectorAll('textarea').forEach(el => {
                const attribute = el.getAttribute('data-attribute') || el.id;
                if (attribute) set(attribute, el.value);
                el.disabled = true;
            });
        }
    
        const sectionCount = get('_section-count') + 1;
        set('_section-count', sectionCount);
        const id = 'squiffy-section-' + sectionCount;
    
        currentSectionElement = document.createElement('div');
        currentSectionElement.classList.add('squiffy-output-section');
        currentSectionElement.id = id;
        if (sectionName) {
            currentSectionElement.setAttribute('data-section', `${sectionName}`);
        }
        outputElement.appendChild(currentSectionElement);
        newBlockOutputElement();
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

            const div = document.createElement('div');
            if (source) {
                div.setAttribute('data-source', source);
            }

            div.innerHTML = html;
            pluginManager.onWrite(div);
            currentBlockOutputElement.appendChild(div);
            ui.scrollToEnd();
        },
        clearScreen: () => {
            outputElement.innerHTML = '';
            newSection(null);
        },
        scrollToEnd: () => {
            if (settings.scroll === 'none') {
                // do nothing
            }
            else if (settings.scroll === 'element') {
                outputElement.lastElementChild.scrollIntoView({ block: 'end', inline: 'nearest', behavior: 'smooth' });
            }
            else {
                let scrollTo = scrollPosition;
                const currentScrollTop = Math.max(document.body.scrollTop, document.documentElement.scrollTop);
                if (scrollTo > currentScrollTop) {
                    const maxScrollTop = document.documentElement.scrollHeight - window.innerHeight;
                    if (scrollTo > maxScrollTop) scrollTo = maxScrollTop;
                    window.scrollTo({ top: scrollTo, behavior: 'smooth' });
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
            outputElement.innerHTML = '';
            go(story.start);
            return;
        }

        updateStory(story, newStory, outputElement, ui, disableLink);

        story = newStory;
        currentSectionElement = outputElement.querySelector('.squiffy-output-section:last-child');
        const sectionName = currentSectionElement.getAttribute('data-section');
        currentSection = story.sections[sectionName];
    }

    // We create a separate div inside the passed-in element. This allows us to clear the text output, but
    // without affecting any overlays that may have been added to the container (for transitions).
    outputElementContainer = options.element;
    outputElement = document.createElement('div');
    outputElementContainer.appendChild(outputElement);
    story = options.story;

    settings = {
        scroll: options.scroll || 'body',
        persist: (options.persist === undefined) ? true : options.persist,
        onSet: options.onSet || (() => {})
    };

    if (options.persist === true && !story.id) {
        console.warn("Persist is set to true in Squiffy runtime options, but no story id has been set. Persist will be disabled.");
        settings.persist = false;
    }

    if (settings.scroll === 'element') {
        outputElement.style.overflowY = 'auto';
    }

    outputElement.addEventListener('click', handleClick);
    outputElement.addEventListener('keypress', async function (event) {
        if (event.key !== "Enter") return;
        await handleClick(event);
    });

    state = new State(settings.persist, story.id || '', settings.onSet, emitter);
    const get = state.get.bind(state);
    const set = state.set.bind(state);

    textProcessor = new TextProcessor(story, state, () => currentSection);
    linkHandler = new LinkHandler();

    const getSectionText = (sectionName: string) => {
        if (sectionName in story.sections) {
            return story.sections[sectionName].text || null;
        }
        return null;
    }

    const getPassageText = (name: string) => {
        if (currentSection.passages && name in currentSection.passages) {
            return currentSection.passages[name].text || null;
        } else if ('passages' in story.sections[''] && story.sections[''].passages && name in story.sections[''].passages) {
            return story.sections[''].passages![name].text || null;
        }
        return null;
    }

    const addTransition = (fn: () => Promise<void>) => {
        transitions.push(fn);
    };

    animation = new Animation();

    pluginManager = new PluginManager(outputElement, textProcessor, state, linkHandler,
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
        on: (e, h) => emitter.on(e, h),
        off: (e, h) => emitter.off(e, h),
        once: (e, h) => emitter.once(e, h),
    };
};