interface SquiffyInitOptions {
    element: HTMLElement;
    story: Story;
}

interface SquiffySettings {
    scroll: string,
    persist: boolean,
    restartPrompt: boolean,
    onSet: (attribute: string, value: any) => void,
}

interface SquiffyApi {
    askRestart: () => void;
    get: (attribute: string) => any;
    set: (attribute: string, value: any) => void;
}

interface Story {
    js: [() => void];
    start: string;
    id: string;
    sections: Record<string, Section>;
}

interface Section {
    text?: string;
    clear?: boolean;
    attributes?: string[],
    jsIndex?: number;
    passages?: Record<string, Passage>;
    passageCount?: number;
}

interface Passage {
    text?: string;
    clear?: boolean;
    attributes?: string[];
    jsIndex?: number;
}

export const init = (options: SquiffyInitOptions): SquiffyApi => {
    let story: Story;
    let currentSection: Section;
    let currentSectionElement: HTMLElement;
    let scrollPosition = 0;
    let outputElement: HTMLElement;
    let settings: SquiffySettings;
    let storageFallback: Record<string, string> = {};
    
    function set(attribute: string, value: any) {
        if (typeof value === 'undefined') value = true;
        if (settings.persist && window.localStorage) {
            localStorage[story.id + '-' + attribute] = JSON.stringify(value);
        }
        else {
            storageFallback[attribute] = JSON.stringify(value);
        }
        settings.onSet(attribute, value);
    }
    
    function get(attribute: string): any {
        let result;
        if (settings.persist && window.localStorage) {
            result = localStorage[story.id + '-' + attribute];
        }
        else {
            result = storageFallback[attribute];
        }
        if (!result) return null;
        return JSON.parse(result);
    }
    
    function initLinkHandler() {
        function handleLink(link: HTMLElement) {
            if (link.classList.contains('disabled')) return;
            let passage = link.getAttribute('data-passage');
            let section = link.getAttribute('data-section');
            const rotateAttr = link.getAttribute('data-rotate');
            const sequenceAttr = link.getAttribute('data-sequence');
            const rotateOrSequenceAttr = rotateAttr || sequenceAttr;
            if (passage) {
                disableLink(link);
                set('_turncount', get('_turncount') + 1);
                passage = processLink(passage);
                if (passage) {
                    currentSectionElement?.appendChild(document.createElement('hr'));
                    showPassage(passage);
                }
                const turnPassage = '@' + get('_turncount');
                if (currentSection.passages) {
                    if (turnPassage in currentSection.passages) {
                        showPassage(turnPassage);
                    }
                    if ('@last' in currentSection.passages && get('_turncount') >= (currentSection.passageCount || 0)) {
                        showPassage('@last');
                    }
                }
            }
            else if (section) {
                currentSectionElement?.appendChild(document.createElement('hr'));
                disableLink(link);
                section = processLink(section);
                if (section) {
                    go(section);
                }
            }
            else if (rotateOrSequenceAttr) {
                const result = rotate(rotateOrSequenceAttr, rotateAttr ? link.innerText : '');
                link.innerHTML = result[0]!.replace(/&quot;/g, '"').replace(/&#39;/g, '\'');
                const dataAttribute = rotateAttr ? 'data-rotate' : 'data-sequence';
                link.setAttribute(dataAttribute, result[1] || '');
                if (!result[1]) {
                    disableLink(link);
                }
                const attribute = link.getAttribute('data-attribute');
                if (attribute) {
                    set(attribute, result[0]);
                }
                save();
            }
        }
    
        function handleClick(event: Event) {
            const target = event.target as HTMLElement;
            if (target.classList.contains('squiffy-link')) {
                handleLink(target);
            }
        }
    
        document.addEventListener('click', handleClick);
        document.addEventListener('keypress', function (event) {
            if (event.key !== "Enter") return;
            handleClick(event);
        });
    }
    
    function disableLink(link: Element) {
        link.classList.add('disabled');
        link.setAttribute('tabindex', '-1');
    }
    
    function disableLinks(links: NodeListOf<Element>) {
        links.forEach(disableLink);
    }
    
    function begin() {
        if (!load()) {
            go(story.start);
        }
    }
    
    function processLink(link: string): string | null {
        const sections = link.split(',');
        let first = true;
        let target = null;
        sections.forEach(function (section) {
            section = section.trim();
            if (startsWith(section, '@replace ')) {
                replaceLabel(section.substring(9));
            }
            else {
                if (first) {
                    target = section;
                }
                else {
                    setAttribute(section);
                }
            }
            first = false;
        });
        return target;
    }
    
    function setAttribute(expr: string) {
        expr = expr.replace(/^(\w*\s*):=(.*)$/, (_, name, value) => (name + "=" + ui.processText(value)));
        const setRegex = /^([\w]*)\s*=\s*(.*)$/;
        const setMatch = setRegex.exec(expr);
        if (setMatch) {
            const lhs = setMatch[1];
            let rhs = setMatch[2];
            if (isNaN(rhs as any)) {
                if (startsWith(rhs, "@")) rhs = get(rhs.substring(1));
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
                if (startsWith(rhs, "@")) rhs = get(rhs.substring(1));
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
                if (startsWith(expr, 'not ')) {
                    expr = expr.substring(4);
                    value = false;
                }
                set(expr, value);
            }
        }
    }
    
    function replaceLabel(expr: string) {
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
        const stripParags = /^<p>(.*)<\/p>$/;
        const stripParagsMatch = stripParags.exec(text);
        if (stripParagsMatch) {
            text = stripParagsMatch[1];
        }
    
        const labelElement = outputElement.querySelector('.squiffy-label-' + label);
        if (!labelElement) return;
    
        labelElement.addEventListener('transitionend', function () {
            labelElement.innerHTML = ui.processText(text);
    
            labelElement.addEventListener('transitionend', function () {
                save();
            }, { once: true });
    
            labelElement.classList.remove('fade-out');
            labelElement.classList.add('fade-in');
        }, { once: true });
    
        labelElement.classList.add('fade-out');
    }
    
    function go(section: string) {
        set('_transition', null);
        newSection();
        currentSection = story.sections[section];
        if (!currentSection) return;
        set('_section', section);
        setSeen(section);
        const master = story.sections[''];
        if (master) {
            run(master);
            ui.write(master.text || '');
        }
        run(currentSection);
        // The JS might have changed which section we're in
        if (get('_section') == section) {
            set('_turncount', 0);
            ui.write(currentSection.text || '');
            save();
        }
    }
    
    function run(section: Section) {
        if (section.clear) {
            ui.clearScreen();
        }
        if (section.attributes) {
            processAttributes(section.attributes.map(line => line.replace(/^random\s*:\s*(\w+)\s*=\s*(.+)/i, (line, attr, options) => (options = options.split("|")) ? attr + " = " + options[Math.floor(Math.random() * options.length)] : line)));
        }
        if (section.jsIndex !== undefined) {
            story.js[section.jsIndex]();
        }
    }
    
    function showPassage(passageName: string) {
        let passage = currentSection.passages && currentSection.passages[passageName];
        const masterSection = story.sections[''];
        if (!passage && masterSection && masterSection.passages) passage = masterSection.passages[passageName];
        if (!passage) return;
        setSeen(passageName);
        if (masterSection && masterSection.passages) {
            const masterPassage = masterSection.passages[''];
            if (masterPassage) {
                run(masterPassage);
                ui.write(masterPassage.text || '');
            }
        }
        const master = currentSection.passages && currentSection.passages[''];
        if (master) {
            run(master);
            ui.write(master.text || '');
        }
        run(passage);
        ui.write(passage.text || '');
        save();
    }
    
    function processAttributes(attributes: string[]) {
        attributes.forEach(function (attribute) {
            if (startsWith(attribute, '@replace ')) {
                replaceLabel(attribute.substring(9));
            }
            else {
                setAttribute(attribute);
            }
        });
    }
    
    function restart() {
        if (settings.persist && window.localStorage) {
            const keys = Object.keys(localStorage);
            keys.forEach(key => {
                if (startsWith(key, story.id)) {
                    localStorage.removeItem(key);
                }
            });
        }
        else {
            storageFallback = {};
        }
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
        const output = get('_output');
        if (!output) return false;
        outputElement.innerHTML = output;
        const element = document.getElementById(get('_output-section'));
        if (!element) return false;
        currentSectionElement = element;
        currentSection = story.sections[get('_section')];
        const transition = get('_transition');
        if (transition) {
            eval('(' + transition + ')()');
        }
        return true;
    }
    
    function setSeen(sectionName: string) {
        let seenSections = get('_seen_sections');
        if (!seenSections) seenSections = [];
        if (seenSections.indexOf(sectionName) == -1) {
            seenSections.push(sectionName);
            set('_seen_sections', seenSections);
        }
    }
    
    function seen(sectionName: string) {
        const seenSections = get('_seen_sections');
        if (!seenSections) return false;
        return (seenSections.indexOf(sectionName) > -1);
    }
    
    function newSection() {
        if (currentSectionElement) {
            disableLinks(currentSectionElement.querySelectorAll('.squiffy-link'));
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
        currentSectionElement.id = id;
        outputElement.appendChild(currentSectionElement);
    
        set('_output-section', id);
    }
    
    const ui = {
        write: (text: string) => {
            if (!currentSectionElement) return;
            scrollPosition = outputElement.scrollHeight;
    
            const div = document.createElement('div');
            currentSectionElement.appendChild(div);
            div.innerHTML = ui.processText(text);
    
            ui.scrollToEnd();
        },
        clearScreen: () => {
            outputElement.innerHTML = '';
            newSection();
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
        processText: (text: string) => {
            function process(text: string, data: any) {
                let containsUnprocessedSection = false;
                const open = text.indexOf('{');
                let close;
    
                if (open > -1) {
                    let nestCount = 1;
                    let searchStart = open + 1;
                    let finished = false;
    
                    while (!finished) {
                        const nextOpen = text.indexOf('{', searchStart);
                        const nextClose = text.indexOf('}', searchStart);
    
                        if (nextClose > -1) {
                            if (nextOpen > -1 && nextOpen < nextClose) {
                                nestCount++;
                                searchStart = nextOpen + 1;
                            }
                            else {
                                nestCount--;
                                searchStart = nextClose + 1;
                                if (nestCount === 0) {
                                    close = nextClose;
                                    containsUnprocessedSection = true;
                                    finished = true;
                                }
                            }
                        }
                        else {
                            finished = true;
                        }
                    }
                }
    
                if (containsUnprocessedSection) {
                    const section = text.substring(open + 1, close);
                    const value = processTextCommand(section, data);
                    text = text.substring(0, open) + value + process(text.substring(close! + 1), data);
                }
    
                return (text);
            }
    
            function processTextCommand(text: string, data: any) {
                if (startsWith(text, 'if ')) {
                    return processTextCommand_If(text, data);
                }
                else if (startsWith(text, 'else:')) {
                    return processTextCommand_Else(text, data);
                }
                else if (startsWith(text, 'label:')) {
                    return processTextCommand_Label(text, data);
                }
                else if (/^rotate[: ]/.test(text)) {
                    return processTextCommand_Rotate('rotate', text);
                }
                else if (/^sequence[: ]/.test(text)) {
                    return processTextCommand_Rotate('sequence', text);
                }
                else if (currentSection.passages && text in currentSection.passages) {
                    return process(currentSection.passages[text].text || '', data);
                }
                else if (text in story.sections) {
                    return process(story.sections[text].text || '', data);
                }
                else if (startsWith(text, '@') && !startsWith(text, '@replace')) {
                    processAttributes(text.substring(1).split(","));
                    return "";
                }
                return get(text);
            }
    
            function processTextCommand_If(section: string, data: any) {
                const command = section.substring(3);
                const colon = command.indexOf(':');
                if (colon == -1) {
                    return ('{if ' + command + '}');
                }
    
                const text = command.substring(colon + 1);
                let condition = command.substring(0, colon);
                condition = condition.replace("<", "&lt;");
                const operatorRegex = /([\w ]*)(=|&lt;=|&gt;=|&lt;&gt;|&lt;|&gt;)(.*)/;
                const match = operatorRegex.exec(condition);
    
                let result = false;
    
                if (match) {
                    const lhs = get(match[1]);
                    const op = match[2];
                    let rhs = match[3];
    
                    if (startsWith(rhs, '@')) rhs = get(rhs.substring(1));
    
                    if (op == '=' && lhs == rhs) result = true;
                    if (op == '&lt;&gt;' && lhs != rhs) result = true;
                    if (op == '&gt;' && lhs > rhs) result = true;
                    if (op == '&lt;' && lhs < rhs) result = true;
                    if (op == '&gt;=' && lhs >= rhs) result = true;
                    if (op == '&lt;=' && lhs <= rhs) result = true;
                }
                else {
                    let checkValue = true;
                    if (startsWith(condition, 'not ')) {
                        condition = condition.substring(4);
                        checkValue = false;
                    }
    
                    if (startsWith(condition, 'seen ')) {
                        result = (seen(condition.substring(5)) == checkValue);
                    }
                    else {
                        let value = get(condition);
                        if (value === null) value = false;
                        result = (value == checkValue);
                    }
                }
    
                const textResult = result ? process(text, data) : '';
    
                data.lastIf = result;
                return textResult;
            }
    
            function processTextCommand_Else(section: string, data: any) {
                if (!('lastIf' in data) || data.lastIf) return '';
                const text = section.substring(5);
                return process(text, data);
            }
    
            function processTextCommand_Label(section: string, data: any) {
                const command = section.substring(6);
                const eq = command.indexOf('=');
                if (eq == -1) {
                    return ('{label:' + command + '}');
                }
    
                const text = command.substring(eq + 1);
                const label = command.substring(0, eq);
    
                return '<span class="squiffy-label-' + label + '">' + process(text, data) + '</span>';
            }
    
            function processTextCommand_Rotate(type: string, section: string) {
                let options;
                let attribute = '';
                if (section.substring(type.length, type.length + 1) == ' ') {
                    const colon = section.indexOf(':');
                    if (colon == -1) {
                        return '{' + section + '}';
                    }
                    options = section.substring(colon + 1);
                    attribute = section.substring(type.length + 1, colon);
                }
                else {
                    options = section.substring(type.length + 1);
                }
                // TODO: Check - previously there was no second parameter here
                const rotation = rotate(options.replace(/"/g, '&quot;').replace(/'/g, '&#39;'), null);
                if (attribute) {
                    set(attribute, rotation[0]);
                }
                return '<a class="squiffy-link" data-' + type + '="' + rotation[1] + '" data-attribute="' + attribute + '" role="link">' + rotation[0] + '</a>';
            }
    
            const data = {
                fulltext: text
            };
            return process(text, data);
        },
        transition: function (f: any) {
            set('_transition', f.toString());
            f();
        },
    };
    
    function startsWith(string: string, prefix: string) {
        return string.substring(0, prefix.length) === prefix;
    }
    
    function rotate(options: string, current: string | null) {
        const colon = options.indexOf(':');
        if (colon == -1) {
            return [options, current];
        }
        const next = options.substring(0, colon);
        let remaining = options.substring(colon + 1);
        if (current) remaining += ':' + current;
        return [next, remaining];
    }

    settings = {
        scroll: 'body',
        persist: true,
        restartPrompt: true,
        onSet: function () { }
    };

    outputElement = options.element;
    story = options.story;

    if (settings.scroll === 'element') {
        outputElement.style.overflowY = 'auto';
    }

    initLinkHandler();
    begin();

    return {
        askRestart: function () {
            if (!settings.restartPrompt || confirm('Are you sure you want to restart?')) {
                restart();
            }
        },
        get: get,
        set: set,
    };
};