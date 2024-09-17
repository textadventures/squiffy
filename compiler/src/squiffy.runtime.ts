interface SquiffyInitOptions {
    element: HTMLElement;
    story: {
        js: [() => void];
        start: string;
        id: string;
        sections: Record<string, Section>;
    }
}

interface SquiffySettings {
    scroll: string,
    persist: boolean,
    restartPrompt: boolean,
    onSet: (attribute: string, value: any) => void,
}

interface SquiffyApi {
    askRestart: () => void;
}

interface Squiffy {
    init: (options: SquiffyInitOptions) => void;
    story: Story;
    set: (attribute: string, value: any) => void;
    get: (attribute: string) => any;
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

let currentSection: Section;
let currentSectionElement: HTMLElement | null = null;
let scrollPosition = 0;
let outputElement: HTMLElement = null!;
let settings: SquiffySettings = null!;
let storageFallback: Record<string, string> = {};

export const squiffy: Squiffy = {
    init: null!,
    story: null!,
    set: function (attribute: string, value: any) {
        if (typeof value === 'undefined') value = true;
        if (settings.persist && window.localStorage) {
            localStorage[squiffy.story.id + '-' + attribute] = JSON.stringify(value);
        }
        else {
            storageFallback[attribute] = JSON.stringify(value);
        }
        settings.onSet(attribute, value);
    },
    get: function (attribute): any {
        var result;
        if (settings.persist && window.localStorage) {
            result = localStorage[squiffy.story.id + '-' + attribute];
        }
        else {
            result = storageFallback[attribute];
        }
        if (!result) return null;
        return JSON.parse(result);
    },
};

var initLinkHandler = function () {
    var handleLink = function (link: HTMLElement) {
        if (link.classList.contains('disabled')) return;
        var passage = link.getAttribute('data-passage');
        var section = link.getAttribute('data-section');
        var rotateAttr = link.getAttribute('data-rotate');
        var sequenceAttr = link.getAttribute('data-sequence');
        var rotateOrSequenceAttr = rotateAttr || sequenceAttr;
        if (passage) {
            disableLink(link);
            squiffy.set('_turncount', squiffy.get('_turncount') + 1);
            passage = processLink(passage);
            if (passage) {
                currentSectionElement?.appendChild(document.createElement('hr'));
                showPassage(passage);
            }
            var turnPassage = '@' + squiffy.get('_turncount');
            if (currentSection.passages) {
                if (turnPassage in currentSection.passages) {
                    showPassage(turnPassage);
                }
                if ('@last' in currentSection.passages && squiffy.get('_turncount') >= (currentSection.passageCount || 0)) {
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
            var result = rotate(rotateOrSequenceAttr, rotateAttr ? link.innerText : '');
            link.innerHTML = result[0]!.replace(/&quot;/g, '"').replace(/&#39;/g, '\'');
            var dataAttribute = rotateAttr ? 'data-rotate' : 'data-sequence';
            link.setAttribute(dataAttribute, result[1] || '');
            if (!result[1]) {
                disableLink(link);
            }
            const attribute = link.getAttribute('data-attribute');
            if (attribute) {
                squiffy.set(attribute, result[0]);
            }
            save();
        }
    };

    const handleClick = (event: Event) => {
        var target = event.target as HTMLElement;
        if (target.classList.contains('squiffy-link')) {
            handleLink(target);
        }
    };

    document.addEventListener('click', handleClick);
    document.addEventListener('keypress', function (event) {
        if (event.key !== "Enter") return
        handleClick(event);
    });
};

const disableLink = function (link: Element) {
    link.classList.add('disabled');
    link.setAttribute('tabindex', '-1');
}

const disableLinks = function (links: NodeListOf<Element>) {
    links.forEach(disableLink);
}

const begin = function () {
    if (!load()) {
        go(squiffy.story.start);
    }
};

var processLink = function (link: string) {
    var sections = link.split(',');
    var first = true;
    var target = null;
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
};

var setAttribute = function (expr: string) {
    expr = expr.replace(/^(\w*\s*):=(.*)$/, (_, name, value) => (name + "=" + ui.processText(value)));
    var lhs, rhs, op, value;
    var setRegex = /^([\w]*)\s*=\s*(.*)$/;
    var setMatch = setRegex.exec(expr);
    if (setMatch) {
        lhs = setMatch[1];
        rhs = setMatch[2];
        if (isNaN(rhs as any)) {
            if (startsWith(rhs, "@")) rhs = squiffy.get(rhs.substring(1));
            squiffy.set(lhs, rhs);
        }
        else {
            squiffy.set(lhs, parseFloat(rhs));
        }
    }
    else {
        var incDecRegex = /^([\w]*)\s*([\+\-\*\/])=\s*(.*)$/;
        var incDecMatch = incDecRegex.exec(expr);
        if (incDecMatch) {
            lhs = incDecMatch[1];
            op = incDecMatch[2];
            rhs = incDecMatch[3];
            if (startsWith(rhs, "@")) rhs = squiffy.get(rhs.substring(1));
            rhs = parseFloat(rhs);
            value = squiffy.get(lhs);
            if (value === null) value = 0;
            if (op == '+') {
                value += rhs;
            }
            if (op == '-') {
                value -= rhs;
            }
            if (op == '*') {
                value *= rhs;
            }
            if (op == '/') {
                value /= rhs;
            }
            squiffy.set(lhs, value);
        }
        else {
            value = true;
            if (startsWith(expr, 'not ')) {
                expr = expr.substring(4);
                value = false;
            }
            squiffy.set(expr, value);
        }
    }
};

var replaceLabel = function (expr: string) {
    var regex = /^([\w]*)\s*=\s*(.*)$/;
    var match = regex.exec(expr);
    if (!match) return;
    var label = match[1];
    var text = match[2];
    if (currentSection.passages && text in currentSection.passages) {
        text = currentSection.passages[text].text || '';
    }
    else if (text in squiffy.story.sections) {
        text = squiffy.story.sections[text].text || '';
    }
    var stripParags = /^<p>(.*)<\/p>$/;
    var stripParagsMatch = stripParags.exec(text);
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
};

const go = function (section: string) {
    squiffy.set('_transition', null);
    newSection();
    currentSection = squiffy.story.sections[section];
    if (!currentSection) return;
    squiffy.set('_section', section);
    setSeen(section);
    var master = squiffy.story.sections[''];
    if (master) {
        run(master);
        ui.write(master.text || '');
    }
    run(currentSection);
    // The JS might have changed which section we're in
    if (squiffy.get('_section') == section) {
        squiffy.set('_turncount', 0);
        ui.write(currentSection.text || '');
        save();
    }
};

const run = function (section: Section) {
    if (section.clear) {
        ui.clearScreen();
    }
    if (section.attributes) {
        processAttributes(section.attributes.map(line => line.replace(/^random\s*:\s*(\w+)\s*=\s*(.+)/i, (line, attr, options) => (options = options.split("|")) ? attr + " = " + options[Math.floor(Math.random() * options.length)] : line)));
    }
    if (section.jsIndex !== undefined) {
        squiffy.story.js[section.jsIndex]();
    }
};

const showPassage = function (passageName: string) {
    var passage = currentSection.passages && currentSection.passages[passageName];
    var masterSection = squiffy.story.sections[''];
    if (!passage && masterSection && masterSection.passages) passage = masterSection.passages[passageName];
    if (!passage) return;
    setSeen(passageName);
    if (masterSection && masterSection.passages) {
        var masterPassage = masterSection.passages[''];
        if (masterPassage) {
            run(masterPassage);
            ui.write(masterPassage.text || '');
        }
    }
    var master = currentSection.passages && currentSection.passages[''];
    if (master) {
        run(master);
        ui.write(master.text || '');
    }
    run(passage);
    ui.write(passage.text || '');
    save();
};

var processAttributes = function (attributes: string[]) {
    attributes.forEach(function (attribute) {
        if (startsWith(attribute, '@replace ')) {
            replaceLabel(attribute.substring(9));
        }
        else {
            setAttribute(attribute);
        }
    });
};

const restart = function () {
    if (settings.persist && window.localStorage) {
        var keys = Object.keys(localStorage);
        keys.forEach(key => {
            if (startsWith(key, squiffy.story.id)) {
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
};

const save = function () {
    squiffy.set('_output', outputElement.innerHTML);
};

const load = function () {
    var output = squiffy.get('_output');
    if (!output) return false;
    outputElement.innerHTML = output;
    currentSectionElement = document.getElementById(squiffy.get('_output-section'));
    currentSection = squiffy.story.sections[squiffy.get('_section')];
    var transition = squiffy.get('_transition');
    if (transition) {
        eval('(' + transition + ')()');
    }
    return true;
};

var setSeen = function (sectionName: string) {
    var seenSections = squiffy.get('_seen_sections');
    if (!seenSections) seenSections = [];
    if (seenSections.indexOf(sectionName) == -1) {
        seenSections.push(sectionName);
        squiffy.set('_seen_sections', seenSections);
    }
};

const seen = function (sectionName: string) {
    var seenSections = squiffy.get('_seen_sections');
    if (!seenSections) return false;
    return (seenSections.indexOf(sectionName) > -1);
};

var newSection = function () {
    if (currentSectionElement) {
        disableLinks(currentSectionElement.querySelectorAll('.squiffy-link'));
        currentSectionElement.querySelectorAll('input').forEach(el => {
            const attribute = el.getAttribute('data-attribute') || el.id;
            if (attribute) squiffy.set(attribute, el.value);
            el.disabled = true
        });

        currentSectionElement.querySelectorAll("[contenteditable]").forEach(el => {
            const attribute = el.getAttribute('data-attribute') || el.id;
            if (attribute) squiffy.set(attribute, el.innerHTML);
            (el as HTMLElement).contentEditable = 'false'
        });

        currentSectionElement.querySelectorAll('textarea').forEach(el => {
            const attribute = el.getAttribute('data-attribute') || el.id;
            if (attribute) squiffy.set(attribute, el.value);
            el.disabled = true
        });
    }

    var sectionCount = squiffy.get('_section-count') + 1;
    squiffy.set('_section-count', sectionCount);
    var id = 'squiffy-section-' + sectionCount;

    currentSectionElement = document.createElement('div');
    currentSectionElement.id = id;
    outputElement.appendChild(currentSectionElement);

    squiffy.set('_output-section', id);
};

const ui = {
    write: function (text: string) {
        if (!currentSectionElement) return;
        scrollPosition = outputElement.scrollHeight;
    
        const div = document.createElement('div');
        currentSectionElement.appendChild(div);
        div.innerHTML = ui.processText(text);
        
        ui.scrollToEnd();
    },
    clearScreen: function () {
        outputElement.innerHTML = '';
        newSection();
    },
    scrollToEnd: function () {
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
                var maxScrollTop = document.documentElement.scrollHeight - window.innerHeight;
                if (scrollTo > maxScrollTop) scrollTo = maxScrollTop;
                window.scrollTo({ top: scrollTo, behavior: 'smooth' });
            }
        }
    },
    processText: function (text: string) {
        function process(text: string, data: any) {
            var containsUnprocessedSection = false;
            var open = text.indexOf('{');
            var close;
    
            if (open > -1) {
                var nestCount = 1;
                var searchStart = open + 1;
                var finished = false;
    
                while (!finished) {
                    var nextOpen = text.indexOf('{', searchStart);
                    var nextClose = text.indexOf('}', searchStart);
    
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
                var section = text.substring(open + 1, close);
                var value = processTextCommand(section, data);
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
            else if (text in squiffy.story.sections) {
                return process(squiffy.story.sections[text].text || '', data);
            }
            else if (startsWith(text, '@') && !startsWith(text, '@replace')) {
                processAttributes(text.substring(1).split(","));
                return "";
            }
            return squiffy.get(text);
        }
    
        function processTextCommand_If(section: string, data: any) {
            var command = section.substring(3);
            var colon = command.indexOf(':');
            if (colon == -1) {
                return ('{if ' + command + '}');
            }
    
            var text = command.substring(colon + 1);
            var condition = command.substring(0, colon);
            condition = condition.replace("<", "&lt;");
            var operatorRegex = /([\w ]*)(=|&lt;=|&gt;=|&lt;&gt;|&lt;|&gt;)(.*)/;
            var match = operatorRegex.exec(condition);
    
            var result = false;
    
            if (match) {
                var lhs = squiffy.get(match[1]);
                var op = match[2];
                var rhs = match[3];
    
                if (startsWith(rhs, '@')) rhs = squiffy.get(rhs.substring(1));
    
                if (op == '=' && lhs == rhs) result = true;
                if (op == '&lt;&gt;' && lhs != rhs) result = true;
                if (op == '&gt;' && lhs > rhs) result = true;
                if (op == '&lt;' && lhs < rhs) result = true;
                if (op == '&gt;=' && lhs >= rhs) result = true;
                if (op == '&lt;=' && lhs <= rhs) result = true;
            }
            else {
                var checkValue = true;
                if (startsWith(condition, 'not ')) {
                    condition = condition.substring(4);
                    checkValue = false;
                }
    
                if (startsWith(condition, 'seen ')) {
                    result = (seen(condition.substring(5)) == checkValue);
                }
                else {
                    var value = squiffy.get(condition);
                    if (value === null) value = false;
                    result = (value == checkValue);
                }
            }
    
            var textResult = result ? process(text, data) : '';
    
            data.lastIf = result;
            return textResult;
        }
    
        function processTextCommand_Else(section: string, data: any) {
            if (!('lastIf' in data) || data.lastIf) return '';
            var text = section.substring(5);
            return process(text, data);
        }
    
        function processTextCommand_Label(section: string, data: any) {
            var command = section.substring(6);
            var eq = command.indexOf('=');
            if (eq == -1) {
                return ('{label:' + command + '}');
            }
    
            var text = command.substring(eq + 1);
            var label = command.substring(0, eq);
    
            return '<span class="squiffy-label-' + label + '">' + process(text, data) + '</span>';
        }
    
        function processTextCommand_Rotate(type: string, section: string) {
            var options;
            var attribute = '';
            if (section.substring(type.length, type.length + 1) == ' ') {
                var colon = section.indexOf(':');
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
            var rotation = rotate(options.replace(/"/g, '&quot;').replace(/'/g, '&#39;'), null);
            if (attribute) {
                squiffy.set(attribute, rotation[0]);
            }
            return '<a class="squiffy-link" data-' + type + '="' + rotation[1] + '" data-attribute="' + attribute + '" role="link">' + rotation[0] + '</a>';
        }
    
        var data = {
            fulltext: text
        };
        return process(text, data);
    },
    transition: function (f: any) {
        squiffy.set('_transition', f.toString());
        f();
    },
};

storageFallback = {};

var startsWith = function (string: string, prefix: string) {
    return string.substring(0, prefix.length) === prefix;
};

var rotate = function (options: string, current: string | null) {
    var colon = options.indexOf(':');
    if (colon == -1) {
        return [options, current];
    }
    var next = options.substring(0, colon);
    var remaining = options.substring(colon + 1);
    if (current) remaining += ':' + current;
    return [next, remaining];
};

squiffy.init = function (options: SquiffyInitOptions): SquiffyApi {
    settings = {
        scroll: 'body',
        persist: true,
        restartPrompt: true,
        onSet: function () { }
    };

    outputElement = options.element;
    squiffy.story = options.story;

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
        }
    };
};

export const get = squiffy.get;
export const set = squiffy.set;