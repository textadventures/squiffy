import type { Plugin } from "vite";

// Handlebars' code generator only uses the source-map library for templates compiled with a
// srcName, which Squiffy never does, and has a stand-in of its own for when the library isn't
// there. So the library is left out of the bundles (the runtime's, and the editor's), which saves
// about 25KB in each.
export const noSourceMap: Plugin = {
    name: "no-source-map",
    enforce: "pre",
    resolveId: id => id == "source-map" ? "\0no-source-map" : null,
    load: id => id == "\0no-source-map" ? "export default {};" : null,
};
