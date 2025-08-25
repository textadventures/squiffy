import { SquiffyApi, SquiffyInitOptions, SquiffySettings, Story, Section } from './types.js';
import { TextProcessor } from './textProcessor.js';
import { Emitter, SquiffyEventMap } from './events.js';
import { State } from "./state.js";
import { updateStory } from "./updater.js";
import {PluginManager} from "./pluginManager.js";
import {RotateSequencePlugin} from "./plugins/rotateSequence.js";
import {RandomPlugin} from "./plugins/random.js";
import {LivePlugin} from "./plugins/live.js";
import {LinkHandler} from "./linkHandler.js";

export type { SquiffyApi } from "./types.js"

export const init = async (options: SquiffyInitOptions): Promise<SquiffyApi> => {
    let story: Story;
    let currentSection: Section;
    let currentSectionElement: HTMLElement;
    let currentBlockOutputElement: HTMLElement;
    let scrollPosition = 0;
    let outputElement: HTMLElement;
    let settings: SquiffySettings;
    let state: State;
    let textProcessor: TextProcessor;
    let linkHandler: LinkHandler;
    let pluginManager: PluginManager;
    const emitter = new Emitter<SquiffyEventMap>();
    
    async function handleLink(link: HTMLElement): Promise<boolean> {
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
                newBlockOutputElement();
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
        const settersJson = link.getAttribute('data-set');
        if (settersJson) {
            const setters = JSON.parse(settersJson) as string[];
            for (const attribute of setters) {
                setAttribute(attribute);
            }
        }
        const replacementsJson = link.getAttribute('data-replace');
        if (replacementsJson) {
            const replacements = JSON.parse(replacementsJson) as string[];
            for (const replacement of replacements) {
                await replaceLabel(replacement);
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
    
    async function replaceLabel(expr: string) {
        const regex = /^([\w]*)\s*=\s*(.*)$/;
        const match = regex.exec(expr);
        if (!match) return;
        const label = match[1];
        let text = match[2];
        if (currentSection.passages && text in currentSection.passages) {
            text = currentSection.passages[text].text || '';
        }
        else if (text in story.sections) {
            text = story.sections[text].text || '';
        }

        const labelElement = outputElement.querySelector('.squiffy-label-' + label) as HTMLElement;
        if (!labelElement) return;

        text = ui.processText(text, true);
        console.log("Start fade...");
        await fadeReplace(labelElement, text);
        console.log("...fade done");
        save();
    }

    function fadeReplace(element: HTMLElement, text: string): Promise<void> {
        return new Promise((resolve) => {
            element.addEventListener('transitionend', function () {
                element.innerHTML = text;

                element.addEventListener('transitionend', function () {
                    resolve();
                }, { once: true });

                element.classList.remove('fade-out');
                element.classList.add('fade-in');
            }, { once: true });

            element.classList.add('fade-out');
        });
    }
    
    async function go(sectionName: string) {
        set('_transition', null);
        newSection(sectionName);
        currentSection = story.sections[sectionName];
        if (!currentSection) return;
        set('_section', sectionName);
        state.setSeen(sectionName);
        const master = story.sections[''];
        if (master) {
            await run(master);
            ui.write(master.text || '', "[[]]");
        }
        await run(currentSection);
        // The JS might have changed which section we're in
        if (get('_section') == sectionName) {
            set('_turncount', 0);
            ui.write(currentSection.text || '', `[[${sectionName}]]`);
            save();
        }
    }
    
    async function run(section: Section) {
        if (section.clear) {
            ui.clearScreen();
        }
        if (section.attributes) {
            await processAttributes(section.attributes);
        }
        if (section.jsIndex !== undefined) {
            const squiffy = {
                get: get,
                set: set,
                ui: {
                    transition: ui.transition,
                    write: ui.write,
                    scrollToEnd: ui.scrollToEnd,
                },
                story: {
                    go: go,
                },
            };
            story.js[section.jsIndex](squiffy, get, set);
        }
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
                await run(masterPassage);
                ui.write(masterPassage.text || '', `[[]][]`);
            }
        }
        const master = currentSection.passages && currentSection.passages[''];
        if (master) {
            await run(master);
            ui.write(master.text || '', `[[${get("_section")}]][]`);
        }
        await run(passage);
        ui.write(passage.text || '', `[[${get("_section")}]][${passageName}]`);
        save();
    }
    
    async function processAttributes(attributes: string[]) {
        for (const attribute of attributes) {
            if (attribute.startsWith('@replace ')) {
                await replaceLabel(attribute.substring(9));
            }
            else {
                setAttribute(attribute);
            }
        }
    }
    
    function restart() {
        state.reset();
        if (settings.scroll === 'element') {
            outputElement.innerHTML = '';
            begin();
        }
        else {
            location.reload();
        }
    }
    
    function save() {
        set('_output', outputElement.innerHTML);
    }
    
    function load() {
        state.load();
        const output = get('_output');
        if (!output) return false;
        outputElement.innerHTML = output;

        currentSectionElement = outputElement.querySelector('.squiffy-output-section:last-child');
        currentBlockOutputElement = outputElement.querySelector('.squiffy-output-block:last-child');

        currentSection = story.sections[get('_section')];
        const transition = get('_transition');
        if (transition) {
            eval('(' + transition + ')()');
        }
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
            if (!currentBlockOutputElement) return;
            scrollPosition = outputElement.scrollHeight;
    
            const div = document.createElement('div');
            if (source) {
                div.setAttribute('data-source', source);
            }

            div.innerHTML = ui.processText(text, false);
            pluginManager.onWrite(div);
            currentBlockOutputElement.appendChild(div);
    
            ui.scrollToEnd();
        },
        clearScreen: () => {
            outputElement.innerHTML = '';
            newSection(null);
        },
        scrollToEnd: () => {
            if (settings.scroll === 'element') {
                const scrollTo = outputElement.scrollHeight - outputElement.clientHeight;
                const currentScrollTop = outputElement.scrollTop;
                if (scrollTo > (currentScrollTop || 0)) {
                    outputElement.scrollTo({ top: scrollTo, behavior: 'smooth' });
                }
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
        transition: function (f: any) {
            set('_transition', f.toString());
            f();
        },
    };

    function update(newStory: Story) {
        updateStory(story, newStory, outputElement, ui, disableLink);

        story = newStory;
        currentSectionElement = outputElement.querySelector('.squiffy-output-section:last-child');
        const sectionName = currentSectionElement.getAttribute('data-section');
        currentSection = story.sections[sectionName];
    }

    outputElement = options.element;
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

    pluginManager = new PluginManager(outputElement, textProcessor, state, linkHandler,
        getSectionText, getPassageText, ui.processText, emitter);
    pluginManager.add(RotateSequencePlugin());
    pluginManager.add(RandomPlugin());
    pluginManager.add(LivePlugin());
    
    await begin();

    return {
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