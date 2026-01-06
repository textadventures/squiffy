import "bootstrap/scss/bootstrap.scss";
import "bootstrap-icons/font/bootstrap-icons.css";
import "chosen-js/chosen.min.css";
import Split from "split.js";
import "./jquery-globals";
import "chosen-js/chosen.jquery.js";
import { Modal, Tab, Tooltip } from "bootstrap";
import { compile as squiffyCompile, CompileError } from "squiffy-compiler";
import { openFile, saveFile, saveFileAs, setOnOpen, getRecentFiles, openRecentFile, clearCurrentFile } from "./file-handler";
import * as editor from "./editor";
import { init as runtimeInit, SquiffyApi } from "squiffy-runtime";
import { SquiffyEventHandler } from "squiffy-runtime/dist/events";
import { createPackage } from "@textadventures/squiffy-packager";
import { getStoryFromCompilerOutput } from "./compiler-helper.ts";
import * as userSettings from "./user-settings.ts";
import initialScript from "./init.squiffy?raw";
import { clearDebugger, logToDebugger } from "./debugger.ts";
import { el, downloadString, downloadUint8Array } from "./util.ts";

Object.assign(window, { $: $, jQuery: $ });

interface Section {
    name: string;
    start: number;
    end?: number;
    isDefault?: boolean;
    passages: Passage[]
}

interface Passage {
    name: string;
    start: number;
    end?: number;
}

let title: string | undefined;
let loading: boolean;
let sourceMap: Section[];
let currentRow: any;
let currentSection: Section | null;
let currentPassage: Passage | null;
let squiffyApi: SquiffyApi | null;
let welcomeModal: Modal | null = null;

function onClick(id: string, fn: () => void) {
    const element = el<HTMLElement>(id);
    element.addEventListener("click", fn);
}

const populateSettingsDialog = function () {
    const fontSizeElement = el<HTMLFormElement>("font-size");
    if (!fontSizeElement) return;
    
    fontSizeElement.value = userSettings.getFontSize();
    fontSizeElement.addEventListener("change", () => {
        let val = fontSizeElement.value;
        if (!val) val = userSettings.defaultSettings.fontSize;
        editor.setFontSize(val);
        userSettings.setFontSize(val);
        fontSizeElement.value = val;
    });
};

const restart = function () {
    clearDebugger();
    setBackButtonEnabled(false);
    squiffyApi?.restart();
};

const goBack = function () {
    squiffyApi?.goBack();
};

const downloadSquiffyScript = function () {
    localSave();
    downloadString(editor.getValue(), title + ".squiffy");
};

const downloadZip = async function () {
    localSave();
    const result = await compile(true);

    if (result.success) {
        const pkg = await createPackage(result, true);

        if (pkg.zip) {
            downloadUint8Array(pkg.zip, "output.zip");
        }
    }
};

const downloadJavascript = async function () {
    localSave();
    const result = await compile(true);

    if (result.success) {
        const js = await result.getJs();
        downloadString(js, title + ".js");
    }
};

const preview = async function () {
    window.open("/preview.html", "_blank");
};

window.addEventListener("message", async e => {
    if (e.data === "preview-ready" && e.source) {
        const script = editor.getValue();
        (e.source as WindowProxy).postMessage(script, "*");
    }
});

const addSection = function () {
    addSectionOrPassage(true);
};

const addPassage = function () {
    addSectionOrPassage(false);
};

const addSectionOrPassage = function (isSection: boolean) {
    const selection = editor.getCopyText();
    let text;

    if (isSection) {
        text = "[[" + selection + "]]";
    }
    else {
        text = "[" + selection + "]";
    }

    if (selection) {
        // replace the selected text with a link to new section/passage
        editor.replaceSelectedText(text);
    }

    text = text + ":\n";

    let insertLine = currentSection!.end!;
    let moveToLine = insertLine;
    if (!insertLine) {
        // adding new section/passage to the end of the document
        insertLine = editor.getLineCount();
        text = "\n\n" + text;
        moveToLine = insertLine + 1;
    }
    else {
        // adding new section/passage in the middle of the document
        text = text + "\n\n";
    }

    editor.replaceLine(insertLine, text);

    if (selection) {
        // move cursor to new section/passage
        editor.moveTo(moveToLine + 1);
    }
    else {
        // no name was specified, so set cursor position to middle of [[ and ]]
        const column = isSection ? 2 : 1;
        editor.moveTo(moveToLine, column);
    }
};

const showSettings = function () {
    new Modal("#settings-dialog").show();
};

const showWelcome = async function (dismissable = false) {
    // Dispose of old modal if it exists
    if (welcomeModal) {
        welcomeModal.dispose();
    }

    const welcomeDialog = document.getElementById("welcome-dialog");
    if (!welcomeDialog) {
        console.error("Welcome dialog element not found");
        return;
    }

    // Create modal with appropriate options
    welcomeModal = new Modal(welcomeDialog, {
        backdrop: dismissable ? true : "static",
        keyboard: dismissable
    });

    // Show/hide close button based on dismissable parameter
    const closeButton = el<HTMLElement>("welcome-close");
    closeButton.style.display = dismissable ? "block" : "none";

    // Clear any previous error messages
    const errorDiv = el<HTMLElement>("welcome-error");
    errorDiv.style.display = "none";
    errorDiv.textContent = "";

    // Populate recent files list
    const recentFiles = await getRecentFiles();
    const recentFilesContainer = el<HTMLElement>("welcome-recent-files");
    const recentFilesList = el<HTMLElement>("welcome-recent-files-list");

    if (recentFiles.length > 0) {
        recentFilesContainer.style.display = "block";

        // Clear existing list
        recentFilesList.innerHTML = "";

        // Add each recent file as a clickable item
        recentFiles.forEach(rf => {
            const item = document.createElement("button");
            item.className = "list-group-item list-group-item-action";
            item.textContent = rf.name;
            item.dataset.fileName = rf.name;
            item.addEventListener("click", () => handleRecentFileClick(rf.name));
            recentFilesList.appendChild(item);
        });
    } else {
        recentFilesContainer.style.display = "none";
    }

    welcomeModal.show();
};

const clearWelcomeError = function () {
    const errorDiv = el<HTMLElement>("welcome-error");
    errorDiv.style.display = "none";
    errorDiv.textContent = "";
};

const handleRecentFileClick = async function (fileName: string) {
    clearWelcomeError();
    const success = await openRecentFile(fileName);
    if (success) {
        welcomeModal?.hide();
    } else {
        // Show error message in the welcome screen
        const errorDiv = el<HTMLElement>("welcome-error");
        errorDiv.textContent = `Could not open "${fileName}". The file may have been moved or deleted.`;
        errorDiv.style.display = "block";
    }
};

const handleWelcomeCreateNew = async function () {
    clearWelcomeError();
    await editorLoad(initialScript);
    welcomeModal?.hide();
};

const handleWelcomeOpenFile = async function () {
    clearWelcomeError();
    try {
        await openFile();
        // Only hide modal if file was successfully opened
        welcomeModal?.hide();
    } catch {
        // Modal stays visible, no message needed (user cancelled)
    }
};

let localSaveTimeout: NodeJS.Timeout | undefined;

const editorChange = async function () {
    if (loading) return;
    setInfo("");
    if (localSaveTimeout) clearTimeout(localSaveTimeout);
    localSaveTimeout = setTimeout(() => {
        localSave();
        processFile();
    }, 50);
    // TODO: Show some indicator that the current file has not been saved

    clearDebugger();
    
    if (squiffyApi) {
        const result = await compile(false);

        if (result.success) {
            const story = getStoryFromCompilerOutput(result.output);
            squiffyApi.update(story);
        }
    }
};

const localSave = function () {
    // TODO
    console.log("TODO: localSave");
    // localStorage.squiffy = editor.getValue();
};

const setInfo = function (text: string) {
    el<HTMLElement>("info").innerHTML = text;
};

const processFile = function () {
    const data = editor.getValue();
    const titleRegex = /^@title (.*)$/;
    const sectionRegex = /^\[\[(.*)\]\]:$/;
    const passageRegex = /^\[(.*)\]:$/;
    let newTitle;

    sourceMap = [
        {
            name: "(Default)",
            start: 0,
            isDefault: true,
            passages: [
                {
                    name: "(Default)",
                    start: 0,
                }
            ]
        }
    ];

    const lines = data.replace(/\r/g, "").split("\n");

    const currentSection = function () {
        return sourceMap.slice(-1)[0];
    };

    const endPassage = function (index: number) {
        const previousPassage = currentSection().passages.slice(-1)[0];
        if (!previousPassage) return;
        previousPassage.end = index;
    };

    lines.forEach(function (line, index) {
        const stripLine = line.trim();
        const titleMatch = titleRegex.exec(stripLine);
        const sectionMatch = sectionRegex.exec(stripLine);
        const passageMatch = passageRegex.exec(stripLine);

        if (titleMatch) {
            newTitle = titleMatch[1];
        }

        if (sectionMatch) {
            endPassage(index);
            currentSection().end = index;
            const newSection = {
                name: sectionMatch[1],
                start: index,
                passages: [
                    {
                        name: "(Default)",
                        start: index
                    }
                ]
            };
            sourceMap.push(newSection);
        }
        else if (passageMatch) {
            endPassage(index);
            const newPassage = {
                name: passageMatch[1],
                start: index
            };
            currentSection().passages.push(newPassage);
        }
    });

    if (!title || title !== newTitle) {
        title = newTitle || "Untitled";
        updateTitle(title);
    }

    const selectSection = $("#sections");
    selectSection.html("");
    sourceMap.forEach(function (section) {
        const name = dropdownName(section.name);
        selectSection.append($("<option />").val(name).text(name));
    });

    cursorMoved(true);
};

const editorLoad = async function (data: string) {
    loading = true;
    editor.setValue(data);
    loading = false;
    localSave();
    processFile();
    await initialCompile();
};

const cursorMoved = function (force?: boolean) {
    const row = editor.getCurrentRow();
    if (!force && row == currentRow) return;
    if (!sourceMap) return;
    currentRow = row;

    let newCurrentSection: Section, newCurrentPassage: Passage;

    sourceMap.forEach(function (section) {
        if (row >= section.start && (!section.end || row < section.end)) {
            newCurrentSection = section;

            section.passages.forEach(function (passage) {
                if (row >= passage.start && (!passage.end || row < passage.end)) {
                    newCurrentPassage = passage;
                }
            });
        }
    });

    if (newCurrentSection! !== currentSection) {
        currentSection = newCurrentSection!;
        $("#sections").val(dropdownName(currentSection.name));
        $("#sections").trigger("chosen:updated");
        const selectPassage = $("#passages");
        selectPassage.html("");
        currentSection.passages.forEach(function (passage) {
            const name = dropdownName(passage.name);
            selectPassage.append($("<option />").val(name).text(name));
        });
    }

    if (newCurrentPassage! !== currentPassage) {
        currentPassage = newCurrentPassage!;
        $("#passages").val(dropdownName(currentPassage.name));
        $("#passages").trigger("chosen:updated");
    }
};

const dropdownName = function (name: string) {
    if (name.length === 0) return "(Master)";
    return name;
};

const sectionChanged = function () {
    const selectedSection = $("#sections").val();
    sourceMap.forEach(function (section) {
        if (dropdownName(section.name) === selectedSection) {
            editor.moveTo(section.start + (section.isDefault ? 0 : 1));
        }
    });
};

const passageChanged = function () {
    const selectedPassage = $("#passages").val();
    currentSection!.passages.forEach(function (passage) {
        if (dropdownName(passage.name) === selectedPassage) {
            editor.moveTo(passage.start + 1);
        }
    });
};

const updateTitle = function (title: string) {
    document.title = title + " - Squiffy Editor";
};

const init = async function () {
    userSettings.initUserSettings();
    populateSettingsDialog();

    editor.init(editorChange, cursorMoved);
    editor.setFontSize(userSettings.getFontSize());
    setOnOpen(editorLoad);

    onClick("restart", restart);
    onClick("back", goBack);
    onClick("file-new", () => {
        clearCurrentFile();
        editorLoad(initialScript);
    });
    onClick("open", openFile);
    onClick("save", () => saveFile(editor.getValue()));
    onClick("save-as", () => saveFileAs(editor.getValue()));

    onClick("download-squiffy-script", downloadSquiffyScript);
    onClick("export-html-js", downloadZip);
    onClick("export-js", downloadJavascript);

    onClick("preview", preview);

    onClick("settings", showSettings);
    onClick("show-welcome", () => showWelcome(true));
    onClick("welcome-create-new", handleWelcomeCreateNew);
    onClick("welcome-open-file", handleWelcomeOpenFile);
    onClick("add-section", addSection);
    onClick("add-passage", addPassage);
    onClick("collapse-all", editor.collapseAll);
    onClick("uncollapse-all", editor.uncollapseAll);

    onClick("edit-undo", editor.undo);
    onClick("edit-redo", editor.redo);
    onClick("edit-cut", editor.cut);
    onClick("edit-copy", editor.copy);
    onClick("edit-paste", editor.paste);
    onClick("edit-select-all", editor.selectAll);
    onClick("edit-find", editor.find);
    onClick("edit-replace", editor.replace);

    $("#sections").on("change", sectionChanged);
    $("#passages").on("change", passageChanged);
    $("#sections, #passages").chosen({ width: "100%" });

    // Show welcome screen after all event handlers are registered
    await showWelcome();
};

const setBackButtonEnabled = function(enabled: boolean) {
    const backButton = document.getElementById("back") as HTMLButtonElement | null;
    if (!backButton) return;
    backButton.disabled = !enabled;
};

const onCanGoBackChanged : SquiffyEventHandler<"canGoBackChanged"> = function (p) {
    setBackButtonEnabled(p.canGoBack);
};

const onSet = function (attribute: string, value: string) {
    // don't log internal attribute changes
    if (attribute.indexOf("_") === 0) return;

    logToDebugger(`${attribute} = ${value}`);
};

const compile = async function(forExportPackage: boolean) {
    const script = editor.getValue();
    const warnings: string[] = [];

    const result = await squiffyCompile({
        scriptBaseFilename: "filename.squiffy",
        script: script,
        onWarning: (message: string) => {
            warnings.push(message);
        },
        globalJs: forExportPackage,
    });

    if (!result.success) {
        showErrors(result);
    }

    showWarnings(warnings);

    return result;
};

const initialCompile = async function () {
    const result = await compile(false);

    if (!result.success) {
        return;
    }

    const story = getStoryFromCompilerOutput(result.output);

    const outputContainer = el<HTMLElement>("output-container");
    outputContainer.innerHTML = "";
    const newOutput = document.createElement("div");
    newOutput.id = "output";
    outputContainer.appendChild(newOutput);

    squiffyApi = await runtimeInit({
        element: newOutput,
        scroll: "element",
        persist: false,
        onSet: onSet,
        story: story,
    });

    setBackButtonEnabled(false);
    squiffyApi.on("canGoBackChanged", onCanGoBackChanged);

    await squiffyApi.begin();
};

const showErrors = function (result: CompileError) {
    for (const err of result.errors) {
        logToDebugger(err);
    }
};

const showWarnings = function (warnings: string[]) {
    for (const warning of warnings) {
        logToDebugger(warning);
    }
};

document.addEventListener("DOMContentLoaded", async () => {
    const triggerTabList = document.querySelectorAll("#tabs button");
    triggerTabList.forEach(triggerEl => {
        const tabTrigger = new Tab(triggerEl);

        triggerEl.addEventListener("click", event => {
            event.preventDefault();
            tabTrigger.show();
        });
    });

    const tooltipTriggerList = document.querySelectorAll('[data-bs-toggle="tooltip"]');
    [...tooltipTriggerList].map(tooltipTriggerEl => new Tooltip(tooltipTriggerEl));

    // const saved = localStorage.squiffy;
    // if (saved) {
    //     await init(localStorage.squiffy);
    // } else {
        await init();
    // }
});

Split(["#left-pane", "#right-pane"]);
Split(["#output-container", "#debugger"], {
    direction: "vertical",
    sizes: [75, 25],
});

clearDebugger();