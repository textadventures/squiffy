// The helpers the runtime registers, and Handlebars' own, so that the compiler can tell a helper
// from an attribute in {{name}}. runtime/src/helpers.test.ts fails if this goes out of date.
export const BUILT_IN_HELPERS: ReadonlySet<string> = new Set([
    // Handlebars' own
    "each", "if", "unless", "with", "log", "lookup",
    // The runtime's
    "abs", "add", "addclass", "and", "animate", "append", "array", "at", "capitalise", "capitalize", "ceil",
    "clear", "cond", "contains", "content", "count", "deactivate", "dec", "div", "embed", "eq", "every", "first",
    "firsttime", "floor", "forget", "get", "goto", "gt", "gte", "hasclass", "headertitle", "inc", "indexof", "join", "label", "last", "lastvisited",
    "length", "live", "lower", "lt", "lte", "max", "min", "mod", "mul", "music", "ne", "not", "once", "or",
    "passage", "passages", "pop", "prepend", "random", "range", "remove", "removeclass", "replace", "restart", "rotate",
    "round", "saves", "section", "sections", "seen", "sequence", "set", "settings", "shuffle", "slice", "sort",
    "sound", "stop", "stopmusic", "stopsounds", "style", "sub", "tags", "toggleclass", "unset", "upper", "visits",
    "youtube",
]);
