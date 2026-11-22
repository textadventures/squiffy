// Options for starlight-llms-txt, which builds llms.txt, llms-full.txt and llms-small.txt from the
// docs, for AI agents that don't have the Squiffy skill. Their links use this build's own site, so
// beta.squiffystory.com's point at the beta docs (see channel.mjs).

import { betaSite, siteUrl, stableSiteUrl } from "./channel.mjs";

const channel = betaSite
    ? `These docs are for the next release of Squiffy, which is still in development, so some of what's here isn't in the current release yet. To use the command line tool they describe, run the beta: \`npx @textadventures/squiffy-cli@beta\`. The docs for the current release are at ${stableSiteUrl}/llms.txt.`
    : "These docs are for the current stable release of Squiffy.";

/** @type {Parameters<typeof import("starlight-llms-txt").default>[0]} */
export const llmsTxtOptions = {
    description: "Squiffy is a free, open source tool for writing interactive stories and multiple-choice games. A story is written in `.squiffy` text files, a kind of Markdown with links between sections and passages, and published as a web page.",
    details: `${channel}

Important notes for writing Squiffy stories:

- A story is divided into sections (\`[[section name]]:\`) and passages (\`[passage name]:\`). Clicking a link to a new section makes the previous links unclickable, so the story moves forward. A section's passage links can be clicked in any order until the player leaves the section.
- A \`squiffy.json\` project file in the story's folder makes every \`.squiffy\`, \`.css\` and \`.js\` file in the folder part of the story, and switches on Squiffy 7's rules for setting attributes, where text goes in quotes and other attributes are named without an \`@\`: \`@set weapon = "sword"\`, \`@set best = score\`, \`[[Go]](next, name = "Bob", gold += price)\`. A story without a \`squiffy.json\` keeps the Squiffy 6 rules (\`@set weapon = sword\`, \`@set best = @score\`). Every story made in the Squiffy 7 editor has one, and \`npx @textadventures/squiffy-cli --convert-v6\` converts an older story and adds one.
- The command line tool, \`npx @textadventures/squiffy-cli\`, lets an agent check its work without a browser. Run it in the story's folder (or give it a \`.squiffy\` file):
  - \`--check\` reports problems without building: compile errors, and warnings such as unreachable sections and dead ends.
  - \`--play\` plays the story as text, printing the text and the links after each step. \`--choose\` clicks a link (by its text or number, and can be repeated), \`--choices file\` clicks one link per line of a file, \`--input attribute=value\` fills in a text box, and \`--save file.json\` carries on between runs, so an agent can play a step at a time. \`--play --interactive --json\` plays in one process instead, reading a link (or \`:input attribute=value\`) from each line of standard input and writing each step as a line of JSON, for a script playing a long story.
  - \`--random\` plays many times, clicking at random, and reports errors, dead ends, endings reached and sections never visited, each problem with the \`--play\` options that get to it again.
  - \`--play ... --record file.squiffy-test\` records a playthrough as a test, and \`--test\` plays every test again, reporting where the story now goes differently (\`--update\` records failing tests again, and \`--ignore\` with \`--record\` leaves bookkeeping attributes out of a test).
  - Add \`--json\` to any of them for output that's easy for a program to read.
- The syntax cheat sheet (${siteUrl}/syntax/) and the helpers reference (${siteUrl}/helpers-reference/) are the quickest way into the language. The cookbook (${siteUrl}/cookbook/) has ready-made patterns such as inventories, shops and health.`,
    // Keep llms-small.txt's line breaks, so its lists, tables and headings stay Markdown
    minify: { whitespace: false },
    // The "Section titled ..." links Starlight puts beside each heading
    customSelectors: { all: [".sl-anchor-link"] },
    // The pages most useful for writing a story come first in llms-full.txt and llms-small.txt
    promote: [
        "getting-started",
        "syntax",
        "basic-concepts",
        "attributes",
        "dynamic-text",
        "player-input",
        "helpers-reference",
        "cli",
        "cookbook",
        "multiple-files",
        "buttons-panels-settings",
        "images-and-files",
        "javascript",
        "tutorial",
    ],
    // The editor's own pages, the home page and the long example stories are of little use to an agent
    // working with a story's files, so they go last in llms-full.txt and are left out of llms-small.txt
    demote: ["index", "editor", "story-map", "snippets", "desktop-app", "featured-examples"],
    exclude: ["index", "editor", "story-map", "snippets", "desktop-app", "featured-examples"],
};
