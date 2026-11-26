import * as vscode from "vscode";

// The workspace has a story, or one has just been made: ticks off the first step of the
// getting-started walkthrough (contributes.walkthroughs in package.json), and puts Show Preview,
// Show Story Map and Export in the Command Palette with no story file in front (#700), as they
// then act on the story the Sections view shows
export const setHasStory = () => void vscode.commands.executeCommand("setContext", "squiffyHasStory", true);
