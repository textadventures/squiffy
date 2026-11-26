// What each built-in helper does and the arguments it takes, for completion after {{, {{# and (.
// `args` is what goes after the name, with LSP-style tab stops. `block` is "only" for a helper
// that's only used as {{#name}}...{{/name}}, and true for one that can be either.
// `docs` is the page and heading on the docs site that describes it, for hover and completion.
// A `hidden` helper works, but isn't suggested, as Squiffy has a simpler way to do the same thing:
// {{hero.name}} rather than {{#with hero}}{{name}}{{/with}}, and hero[stat] rather than lookup.
// helper-info.test.ts fails if a helper in BUILT_IN_HELPERS is missing here, or a heading isn't there.
export interface HelperInfo {
    detail: string;
    args?: string;
    block?: true | "only";
    docs?: string;
    hidden?: true;
}

const a_b = "${1:a} ${2:b}";

// The docs site, where a helper's `docs` path goes unless a host gives another (the beta editor's
// is beta.squiffystory.com)
export const DEFAULT_DOCS_URL = "https://squiffystory.com";

export const HELPER_INFO: Record<string, HelperInfo> = {
    // Handlebars' own
    if: { detail: "Show the text only if a condition is true", args: "${1:condition}", block: "only", docs: "/helpers-reference/#conditions" },
    unless: { detail: "Show the text only if a condition is false", args: "${1:condition}", block: "only", docs: "/helpers-reference/#conditions" },
    each: { detail: "Repeat the text for each item in an array, as {{this}}", args: "${1:array}", block: "only", docs: "/attributes/#going-through-an-array" },
    with: { detail: "Show the text with an object's properties as attributes", args: "${1:object}", block: "only", hidden: true },
    log: { detail: "Write a value to the browser's console", args: "${1:value}", hidden: true },
    lookup: { detail: "A property of an object, or an item of an array", args: "${1:object} ${2:key}", hidden: true },

    // The runtime's
    abs: { detail: "A number without its minus sign", args: "${1:number}", docs: "/helpers-reference/#maths-helpers" },
    add: { detail: "Add two numbers, or join them as text", args: a_b, docs: "/helpers-reference/#maths-helpers" },
    addclass: { detail: "Add classes to the story", args: "\"${1:class}\"", docs: "/helpers-reference/#class-helpers" },
    and: { detail: "Whether all the values are true", args: a_b, docs: "/helpers-reference/#logic-helpers" },
    animate: { detail: "Animate the text inside", args: "\"${1:effect}\"", block: "only", docs: "/helpers-reference/#animation" },
    append: { detail: "Add a value to the end of an array attribute", args: "\"${1:attribute}\" ${2:value}", docs: "/helpers-reference/#creating-and-modifying-arrays" },
    array: { detail: "Make an array", args: "${1:item} ${2:item}", docs: "/helpers-reference/#creating-and-modifying-arrays" },
    at: { detail: "Whether the player is at a section", args: "\"${1:section}\"", docs: "/helpers-reference/#navigation-helpers" },
    capitalise: { detail: "The text with a capital first letter", args: "${1:text}", docs: "/helpers-reference/#text-helpers" },
    capitalize: { detail: "The text with a capital first letter", args: "${1:text}", docs: "/helpers-reference/#text-helpers" },
    ceil: { detail: "Round a number up", args: "${1:number}", docs: "/helpers-reference/#maths-helpers" },
    clear: { detail: "Clear the screen", docs: "/helpers-reference/#navigation-helpers" },
    cond: { detail: "One value if a condition is true, another if not", args: "${1:condition} ${2:value} ${3:otherwise}", docs: "/helpers-reference/#choosing-between-two-values" },
    contains: { detail: "Whether an array contains a value", args: "${1:array} ${2:value}", docs: "/helpers-reference/#querying-arrays" },
    content: { detail: "In embedded text, the text the embed wraps", docs: "/helpers-reference/#content-helpers" },
    count: { detail: "How many times a value is in an array", args: "${1:array} ${2:value}", docs: "/helpers-reference/#joining-sorting-and-more" },
    deactivate: { detail: "Turn off the links to passages in this section", args: "\"${1:passage}\"", docs: "/helpers-reference/#navigation-helpers" },
    dec: { detail: "Subtract 1, or an amount, from an attribute", args: "\"${1:attribute}\"", docs: "/helpers-reference/#attribute-helpers" },
    div: { detail: "Divide a by b", args: a_b, docs: "/helpers-reference/#maths-helpers" },
    embed: { detail: "Embed text from another section or passage", args: "\"${1:name}\"", block: true, docs: "/helpers-reference/#content-helpers" },
    eq: { detail: "Whether a equals b", args: a_b, docs: "/helpers-reference/#comparison-helpers" },
    every: { detail: "Show the text again every so many milliseconds", args: "${1:1000}", block: "only", docs: "/dynamic-text/#repeating-text" },
    first: { detail: "An array's first item", args: "${1:array}", docs: "/helpers-reference/#joining-sorting-and-more" },
    firsttime: { detail: "Show the text only the first time", block: "only", docs: "/dynamic-text/#the-first-time" },
    floor: { detail: "Round a number down", args: "${1:number}", docs: "/helpers-reference/#maths-helpers" },
    forget: { detail: "Clear the attributes that last between playthroughs", docs: "/helpers-reference/#attribute-helpers" },
    get: { detail: "An attribute's value", args: "\"${1:attribute}\"", docs: "/helpers-reference/#attribute-helpers" },
    goto: { detail: "Go to a section", args: "\"${1:section}\"", docs: "/helpers-reference/#navigation-helpers" },
    gt: { detail: "Whether a is more than b", args: a_b, docs: "/helpers-reference/#comparison-helpers" },
    gte: { detail: "Whether a is more than or equal to b", args: a_b, docs: "/helpers-reference/#comparison-helpers" },
    hasclass: { detail: "Whether the story has a class", args: "\"${1:class}\"", docs: "/helpers-reference/#class-helpers" },
    headertitle: { detail: "Show a title in the bar above the story", args: "\"${1:title}\"", docs: "/helpers-reference/#header-title-helper" },
    inc: { detail: "Add 1, or an amount, to an attribute", args: "\"${1:attribute}\"", docs: "/helpers-reference/#attribute-helpers" },
    indexof: { detail: "A value's position in an array, or -1", args: "${1:array} ${2:value}", docs: "/helpers-reference/#joining-sorting-and-more" },
    join: { detail: "An array's items as text", args: "${1:array} \"${2:, }\"", docs: "/helpers-reference/#joining-sorting-and-more" },
    label: { detail: "Text that {{#replace}} can change later", args: "\"${1:name}\"", block: "only", docs: "/helpers-reference/#labels-and-replacement" },
    last: { detail: "An array's last item", args: "${1:array}", docs: "/helpers-reference/#joining-sorting-and-more" },
    lastvisited: { detail: "How many turns ago the player was at a section or passage", args: "\"${1:name}\"", docs: "/helpers-reference/#navigation-helpers" },
    length: { detail: "The number of items in an array", args: "${1:array}", docs: "/helpers-reference/#querying-arrays" },
    live: { detail: "An attribute's value, kept up to date as it changes", args: "\"${1:attribute}\"", docs: "/dynamic-text/#live" },
    lower: { detail: "The text in small letters", args: "${1:text}", docs: "/helpers-reference/#text-helpers" },
    lt: { detail: "Whether a is less than b", args: a_b, docs: "/helpers-reference/#comparison-helpers" },
    lte: { detail: "Whether a is less than or equal to b", args: a_b, docs: "/helpers-reference/#comparison-helpers" },
    max: { detail: "The largest of the numbers", args: a_b, docs: "/helpers-reference/#maths-helpers" },
    min: { detail: "The smallest of the numbers", args: a_b, docs: "/helpers-reference/#maths-helpers" },
    mod: { detail: "The remainder after dividing a by b", args: a_b, docs: "/helpers-reference/#maths-helpers" },
    mul: { detail: "Multiply a by b", args: a_b, docs: "/helpers-reference/#maths-helpers" },
    music: { detail: "Play music", args: "\"${1:file}\"", docs: "/helpers-reference/#sound-helpers" },
    ne: { detail: "Whether a isn't equal to b", args: a_b, docs: "/helpers-reference/#comparison-helpers" },
    not: { detail: "Whether a value is false", args: "${1:value}", docs: "/helpers-reference/#logic-helpers" },
    once: { detail: "Show the text only the first time", block: "only", docs: "/dynamic-text/#the-first-time" },
    or: { detail: "Whether any of the values is true", args: a_b, docs: "/helpers-reference/#logic-helpers" },
    passage: { detail: "A link to a passage", args: "\"${1:name}\" text=\"${2:label}\"", docs: "/helpers-reference/#link-helpers" },
    passages: { detail: "The names of a section's passages", args: "\"${1:section}\"", docs: "/helpers-reference/#listing-sections-and-passages" },
    pop: { detail: "Remove and return an array attribute's first item", args: "\"${1:attribute}\"", docs: "/helpers-reference/#creating-and-modifying-arrays" },
    prepend: { detail: "Add a value to the start of an array attribute", args: "\"${1:attribute}\" ${2:value}", docs: "/helpers-reference/#creating-and-modifying-arrays" },
    random: { detail: "A random item from an array", args: "${1:array}", docs: "/helpers-reference/#random-text" },
    range: { detail: "The whole numbers from one number to another", args: "${1:from} ${2:to}", docs: "/helpers-reference/#joining-sorting-and-more" },
    remove: { detail: "Remove a value from an array attribute", args: "\"${1:attribute}\" ${2:value}", docs: "/helpers-reference/#creating-and-modifying-arrays" },
    removeclass: { detail: "Take classes off the story", args: "\"${1:class}\"", docs: "/helpers-reference/#class-helpers" },
    replace: { detail: "Replace the text of a {{#label}}", args: "\"${1:label}\"", block: "only", docs: "/helpers-reference/#labels-and-replacement" },
    restart: { detail: "A link that restarts the story", docs: "/helpers-reference/#link-helpers" },
    rotate: { detail: "A link that cycles through options", args: "${1:array}", docs: "/helpers-reference/#rotating-and-sequence-links" },
    round: { detail: "Round a number to the nearest whole number", args: "${1:number}", docs: "/helpers-reference/#maths-helpers" },
    saves: { detail: "A link that opens the Saved games dialog", docs: "/helpers-reference/#link-helpers" },
    section: { detail: "A link to a section", args: "\"${1:name}\" text=\"${2:label}\"", docs: "/helpers-reference/#link-helpers" },
    sections: { detail: "The names of the story's sections", docs: "/helpers-reference/#listing-sections-and-passages" },
    seen: { detail: "Whether a section or passage has been seen", args: "\"${1:name}\"", docs: "/helpers-reference/#navigation-helpers" },
    sequence: { detail: "A link that goes through options once", args: "${1:array}", docs: "/helpers-reference/#rotating-and-sequence-links" },
    set: { detail: "Set an attribute", args: "\"${1:attribute}\" ${2:value}", docs: "/helpers-reference/#attribute-helpers" },
    settings: { detail: "A link that opens the Settings dialog", docs: "/helpers-reference/#link-helpers" },
    shuffle: { detail: "An array's items in a random order", args: "${1:array}", docs: "/helpers-reference/#joining-sorting-and-more" },
    slice: { detail: "Part of an array or text", args: "${1:array} ${2:start} ${3:end}", docs: "/helpers-reference/#joining-sorting-and-more" },
    sort: { detail: "An array's items in order", args: "${1:array}", docs: "/helpers-reference/#joining-sorting-and-more" },
    sound: { detail: "Play a sound once", args: "\"${1:file}\"", docs: "/helpers-reference/#sound-helpers" },
    stop: { detail: "Inside {{#every}}, stop repeating", docs: "/helpers-reference/#navigation-helpers" },
    stopmusic: { detail: "Fade out the music", docs: "/helpers-reference/#sound-helpers" },
    stopsounds: { detail: "Stop the sounds that are playing", docs: "/helpers-reference/#sound-helpers" },
    style: { detail: "Give the text inside classes", args: "\"${1:class}\"", block: "only", docs: "/helpers-reference/#styling-text" },
    sub: { detail: "Subtract b from a", args: a_b, docs: "/helpers-reference/#maths-helpers" },
    tags: { detail: "A section's or passage's tags", args: "\"${1:name}\"", docs: "/helpers-reference/#listing-sections-and-passages" },
    toggleclass: { detail: "Add classes, or take them off if they're there", args: "\"${1:class}\"", docs: "/helpers-reference/#class-helpers" },
    unset: { detail: "Set an attribute to false", args: "\"${1:attribute}\"", docs: "/helpers-reference/#attribute-helpers" },
    upper: { detail: "The text in capitals", args: "${1:text}", docs: "/helpers-reference/#text-helpers" },
    visits: { detail: "How many times a section or passage has been visited", args: "\"${1:name}\"", docs: "/helpers-reference/#navigation-helpers" },
    youtube: { detail: "Show a YouTube video", args: "\"${1:address}\"", docs: "/helpers-reference/#video-helper" },
};
