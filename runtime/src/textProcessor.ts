import { startsWith, rotate } from "./utils.js";

export class TextProcessor {
    get: (attribute: string) => any;
    set: (attribute: string, value: any) => void;
    story: any;
    currentSection: any;
    seen: (section: string) => boolean;
    processAttributes: (attributes: string[]) => void;

    constructor (get: (attribute: string) => any,
                 set: (attribute: string, value: any) => void,
                 story: any, currentSection: any,
                 seen: (section: string) => boolean,
                 processAttributes: (attributes: string[]) => void) {
        this.get = get;
        this.set = set;
        this.story = story;
        this.currentSection = currentSection;
        this.seen = seen;
        this.processAttributes = processAttributes;
    }

    process(text: string, data: any) {
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
                    } else {
                        nestCount--;
                        searchStart = nextClose + 1;
                        if (nestCount === 0) {
                            close = nextClose;
                            containsUnprocessedSection = true;
                            finished = true;
                        }
                    }
                } else {
                    finished = true;
                }
            }
        }

        if (containsUnprocessedSection) {
            const section = text.substring(open + 1, close);
            const value = this.processTextCommand(section, data);
            text = text.substring(0, open) + value + this.process(text.substring(close! + 1), data);
        }

        return (text);
    }

    processTextCommand(text: string, data: any) {
        if (startsWith(text, 'if ')) {
            return this.processTextCommand_If(text, data);
        } else if (startsWith(text, 'else:')) {
            return this.processTextCommand_Else(text, data);
        } else if (startsWith(text, 'label:')) {
            return this.processTextCommand_Label(text, data);
        } else if (/^rotate[: ]/.test(text)) {
            return this.processTextCommand_Rotate('rotate', text);
        } else if (/^sequence[: ]/.test(text)) {
            return this.processTextCommand_Rotate('sequence', text);
        } else if (this.currentSection.passages && text in this.currentSection.passages) {
            return this.process(this.currentSection.passages[text].text || '', data);
        } else if (text in this.story.sections) {
            return this.process(this.story.sections[text].text || '', data);
        } else if (startsWith(text, '@') && !startsWith(text, '@replace')) {
            this.processAttributes(text.substring(1).split(","));
            return "";
        }
        return this.get(text);
    }

    processTextCommand_If(section: string, data: any) {
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
            const lhs = this.get(match[1]);
            const op = match[2];
            let rhs = match[3];

            if (startsWith(rhs, '@')) rhs = this.get(rhs.substring(1));

            if (op == '=' && lhs == rhs) result = true;
            if (op == '&lt;&gt;' && lhs != rhs) result = true;
            if (op == '&gt;' && lhs > rhs) result = true;
            if (op == '&lt;' && lhs < rhs) result = true;
            if (op == '&gt;=' && lhs >= rhs) result = true;
            if (op == '&lt;=' && lhs <= rhs) result = true;
        } else {
            let checkValue = true;
            if (startsWith(condition, 'not ')) {
                condition = condition.substring(4);
                checkValue = false;
            }

            if (startsWith(condition, 'seen ')) {
                result = (this.seen(condition.substring(5)) == checkValue);
            } else {
                let value = this.get(condition);
                if (value === null) value = false;
                result = (value == checkValue);
            }
        }

        const textResult = result ? this.process(text, data) : '';

        data.lastIf = result;
        return textResult;
    }

    processTextCommand_Else(section: string, data: any) {
        if (!('lastIf' in data) || data.lastIf) return '';
        const text = section.substring(5);
        return this.process(text, data);
    }

    processTextCommand_Label(section: string, data: any) {
        const command = section.substring(6);
        const eq = command.indexOf('=');
        if (eq == -1) {
            return ('{label:' + command + '}');
        }

        const text = command.substring(eq + 1);
        const label = command.substring(0, eq);

        return '<span class="squiffy-label-' + label + '">' + this.process(text, data) + '</span>';
    }

    processTextCommand_Rotate(type: string, section: string) {
        let options;
        let attribute = '';
        if (section.substring(type.length, type.length + 1) == ' ') {
            const colon = section.indexOf(':');
            if (colon == -1) {
                return '{' + section + '}';
            }
            options = section.substring(colon + 1);
            attribute = section.substring(type.length + 1, colon);
        } else {
            options = section.substring(type.length + 1);
        }
        // TODO: Check - previously there was no second parameter here
        const rotation = rotate(options.replace(/"/g, '&quot;').replace(/'/g, '&#39;'), null);
        if (attribute) {
            this.set(attribute, rotation[0]);
        }
        return '<a class="squiffy-link" data-' + type + '="' + rotation[1] + '" data-attribute="' + attribute + '" role="link">' + rotation[0] + '</a>';
    }
}