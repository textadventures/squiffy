// Reads a Quest 5 game file (.aslx), and the parts of a gamebook in it that the converter needs.
// A saved game has the whole of Quest's core library in it, as well as the author's pages, so this
// only reads the game, its pages, and the library's defaults for the game's settings.

export class QuestParseError extends Error {}

export interface XmlElement {
    name: string;
    attrs: Record<string, string>;
    children: XmlElement[];
    // The element's own text and CDATA, with entities decoded
    text: string;
}

// A small XML reader: ASLX is plain XML, without namespaces or a DTD
export function parseXml(source: string): XmlElement {
    let pos = 0;
    const root: XmlElement = { name: "", attrs: {}, children: [], text: "" };
    const stack: XmlElement[] = [root];
    const top = () => stack[stack.length - 1];

    while (pos < source.length) {
        const lt = source.indexOf("<", pos);
        if (lt == -1) {
            top().text += decodeEntities(source.substring(pos));
            break;
        }
        if (lt > pos) top().text += decodeEntities(source.substring(pos, lt));
        if (source.startsWith("<!--", lt)) {
            pos = endOf(source, "-->", lt);
        }
        else if (source.startsWith("<![CDATA[", lt)) {
            const end = source.indexOf("]]>", lt);
            if (end == -1) throw new QuestParseError("The file ends inside a CDATA section.");
            top().text += source.substring(lt + 9, end);
            pos = end + 3;
        }
        else if (source.startsWith("<?", lt)) {
            pos = endOf(source, "?>", lt);
        }
        else if (source.startsWith("<!", lt)) {
            pos = endOf(source, ">", lt);
        }
        else if (source.startsWith("</", lt)) {
            const end = source.indexOf(">", lt);
            if (end == -1) throw new QuestParseError("The file ends inside a tag.");
            const name = source.substring(lt + 2, end).trim();
            // Close up to the matching element, so a stray closing tag doesn't lose the rest
            const index = stack.map(e => e.name).lastIndexOf(name);
            if (index > 0) stack.length = index;
            pos = end + 1;
        }
        else {
            const tag = /^<([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/.exec(source.substring(lt, lt + 4096));
            if (!tag) {
                // Not a tag: a < in text
                top().text += "<";
                pos = lt + 1;
                continue;
            }
            const attrs: Record<string, string> = {};
            for (const a of tag[2].matchAll(/([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
                attrs[a[1]] = decodeEntities(a[2] ?? a[3]);
            }
            const element: XmlElement = { name: tag[1], attrs, children: [], text: "" };
            top().children.push(element);
            if (tag[3] != "/") stack.push(element);
            pos = lt + tag[0].length;
        }
    }
    return root;
}

function endOf(source: string, terminator: string, from: number): number {
    const end = source.indexOf(terminator, from);
    if (end == -1) throw new QuestParseError("The file ends too soon.");
    return end + terminator.length;
}

const namedEntities: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: "\"", apos: "'" };

// A character reference to something that isn't a character, such as &#x110000;, is left as it is
// rather than throwing a RangeError that isn't a QuestParseError (#644)
const character = (code: number, match: string) => code <= 0x10ffff ? String.fromCodePoint(code) : match;

function decodeEntities(text: string): string {
    return text.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (match, entity: string) => {
        if (entity.startsWith("#x")) return character(parseInt(entity.substring(2), 16), match);
        if (entity.startsWith("#")) return character(parseInt(entity.substring(1), 10), match);
        return Object.hasOwn(namedEntities, entity) ? namedEntities[entity] : match;
    });
}

// An attribute of a Quest object, as the game file has it
export type QuestValue =
    | { type: "string", value: string }
    | { type: "boolean", value: boolean }
    | { type: "number", value: number }
    | { type: "script", value: string }
    | { type: "stringdictionary", value: [string, string][] }
    | { type: "stringlist", value: string[] }
    // Anything else, e.g. an object reference or a list of objects, kept as its text
    | { type: "other", typeName: string, value: string };

// Reads an object's attribute from its element: <name type="...">value</name>, or
// <attr name="name" type="...">. An element with no type and nothing in it is true.
export function readValue(element: XmlElement): QuestValue {
    const type = element.attrs.type;
    const text = element.text;
    switch (type) {
        case undefined:
        case "":
            if (element.children.length == 0 && text.trim() == "") return { type: "boolean", value: true };
            return { type: "string", value: text };
        case "string":
            return { type: "string", value: text };
        case "boolean":
            return { type: "boolean", value: text.trim().toLowerCase() != "false" };
        case "int":
        case "double":
            return { type: "number", value: Number(text.trim()) || 0 };
        case "script":
            return { type: "script", value: text };
        case "stringdictionary":
            return {
                type: "stringdictionary",
                value: element.children.filter(c => c.name == "item").map(item => [
                    item.children.find(c => c.name == "key")?.text ?? item.attrs.key ?? "",
                    item.children.find(c => c.name == "value")?.text ?? "",
                ]),
            };
        case "simplestringlist":
            return { type: "stringlist", value: text.split(/[;\n]/).map(s => s.trim()).filter(s => s) };
        case "stringlist":
        case "list":
            return { type: "stringlist", value: element.children.filter(c => c.name == "value").map(c => c.text) };
        default:
            return { type: "other", typeName: type, value: text };
    }
}

export interface QuestObject {
    name: string;
    // The types it inherits, e.g. "picture" or "scripttext"
    inherits: string[];
    attributes: Map<string, QuestValue>;
    // The objects inside it
    children: QuestObject[];
}

function readObject(element: XmlElement): QuestObject {
    const attributes = new Map<string, QuestValue>();
    const inherits: string[] = [];
    const children: QuestObject[] = [];
    for (const child of element.children) {
        if (child.name == "inherit") {
            if (child.attrs.name) inherits.push(child.attrs.name);
        }
        else if (child.name == "object") {
            children.push(readObject(child));
        }
        else if (child.name == "attr") {
            if (child.attrs.name) attributes.set(child.attrs.name, readValue(child));
        }
        else {
            attributes.set(child.name, readValue(child));
        }
    }
    return { name: element.attrs.name ?? "", inherits, attributes, children };
}

export interface QuestGame {
    // e.g. "550", for Quest 5.5
    aslVersion: string;
    // Whether the game was made in Quest's gamebook mode, rather than as a text adventure
    gamebook: boolean;
    game: QuestObject;
    // The library's defaults for the game's settings, from the defaultgame type in the file
    gameDefaults: Map<string, QuestValue>;
    // The pages, in the order they are in the file, including pages inside other pages
    pages: QuestObject[];
    // The page the player starts on
    start?: string;
    // The player object, whose attributes can be shown with {player.alias} and so on
    player?: QuestObject;
    // The JavaScript files the game includes
    javascript: string[];
}

export function parseQuestGame(source: string): QuestGame {
    const root = parseXml(source.replace(/^\uFEFF/, ""));
    const asl = root.children.find(e => e.name == "asl");
    if (!asl) throw new QuestParseError("This isn't a Quest game: there's no <asl> element in it.");
    const gameElement = asl.children.find(e => e.name == "game");
    if (!gameElement) throw new QuestParseError("This isn't a Quest game: there's no <game> element in it.");
    const game = readObject(gameElement);

    const gameDefaults = new Map<string, QuestValue>();
    const defaultGame = asl.children.find(e => e.name == "type" && e.attrs.name == "defaultgame");
    if (defaultGame) {
        for (const [name, value] of readObject(defaultGame).attributes) gameDefaults.set(name, value);
    }
    const style = game.attributes.get("_editorstyle") ?? gameDefaults.get("_editorstyle");
    const gamebook = (style?.type == "string" && style.value.trim() == "gamebook")
        || asl.children.some(e => e.name == "include" && /^GamebookCore\.aslx$/i.test(e.attrs.ref ?? ""));

    const pages: QuestObject[] = [];
    let start: string | undefined;
    let player: QuestObject | undefined;
    const isPlayer = (o: QuestObject) => o.name == "player" || o.inherits.includes("defaultplayer");
    const collect = (objects: QuestObject[]) => {
        for (const o of objects) {
            if (isPlayer(o)) {
                player ??= o;
                continue;
            }
            pages.push(o);
            if (o.children.some(isPlayer)) start ??= o.name;
            collect(o.children);
        }
    };
    collect(asl.children.filter(e => e.name == "object").map(readObject));

    const javascript = asl.children.filter(e => e.name == "javascript" && e.attrs.src).map(e => e.attrs.src);
    return { aslVersion: asl.attrs.version ?? "", gamebook, game, gameDefaults, pages, start, player, javascript };
}

// Whether some text is a Quest game file
export function isQuestSource(source: string): boolean {
    return /<asl\s+version\s*=/.test(source.substring(0, 2000));
}
