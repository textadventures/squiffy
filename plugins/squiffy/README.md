# Squiffy plugin for Claude Code

A [Claude Code](https://claude.com/claude-code) plugin that helps Claude write, check and play [Squiffy](https://squiffystory.com) stories.

It adds a Squiffy skill, which Claude loads when it works on `.squiffy` files or a folder with a `squiffy.json`. The skill covers Squiffy's syntax, the difference between Squiffy 6 and Squiffy 7 stories, and how to check and play a story with the Squiffy command-line tool after each change.

## Installing

```text
/plugin marketplace add textadventures/squiffy
/plugin install squiffy@squiffy
```

The command-line tool runs with `npx`, so you'll also need [Node.js](https://nodejs.org/).

See [Writing with an AI agent](https://squiffystory.com/writing-with-ai/) for more.

## Developing

The skill is `skills/squiffy/SKILL.md`, with detail in `skills/squiffy/references/`. To try changes, from the root of this repository:

```text
/plugin marketplace add ./
/plugin install squiffy@squiffy
```

and check the plugin with `claude plugin validate ./`. When Squiffy's language changes, update the references along with the docs in `site/`.
