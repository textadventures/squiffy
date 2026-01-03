import pkg from '../package.json' with { type: 'json' };
const version = pkg.version;
import 'bootstrap/scss/bootstrap.scss';
import 'bootstrap-icons/font/bootstrap-icons.css'
import 'chosen-js/chosen.min.css'
import Split from 'split.js'
import './jquery-globals';
import "chosen-js/chosen.jquery.js"
import { Modal, Tab, Tooltip } from 'bootstrap'
import {compile as squiffyCompile, CompileError} from 'squiffy-compiler';
import { openFile, saveFile } from './file-handler';
import { Settings } from './settings';
import * as editor from './editor';
import { init as runtimeInit, SquiffyApi } from 'squiffy-runtime';
import {SquiffyEventHandler} from "squiffy-runtime/dist/events";
import {createPackage} from "@textadventures/squiffy-packager";
import {getStoryFromCompilerOutput} from "./compiler-helper.ts";

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

var settings: Settings;
var title: string | undefined;
var loading: boolean;
var sourceMap: Section[];
var currentRow: any;
var currentSection: Section | null;
var currentPassage: Passage | null;
let squiffyApi: SquiffyApi | null;

const defaultSettings = {
    fontSize: "12"
};

const initUserSettings = function () {
    var us = settings.userSettings;
    var fontSize = us.get('fontSize');
    if (!fontSize) {
        us.set('fontSize', defaultSettings.fontSize);
    }
};

function el<T>(id: string) {
    return document.getElementById(id) as T;
}

function onClick(id: string, fn: () => void) {
    const element = el<HTMLElement>(id);
    element.addEventListener("click", fn);
}

const populateSettingsDialog = function () {
    const us = settings.userSettings;
    const fontSizeElement = el<HTMLFormElement>('font-size');
    if (!fontSizeElement) return;
    
    fontSizeElement.value = us.get('fontSize');
    fontSizeElement.addEventListener('change', () => {
        let val = fontSizeElement.value;
        if (!val) val = defaultSettings.fontSize;
        editor.setFontSize(val);
        us.set('fontSize', val);
        fontSizeElement.value = val;
    });
};

const clearDebugger = function () {
    el<HTMLElement>('debugger').innerHTML = '';
    logToDebugger("Squiffy " + version);
};

const restart = function () {
    clearDebugger();
    setBackButtonEnabled(false);
    squiffyApi?.restart();
};

const goBack = function () {
    squiffyApi?.goBack();
}

const downloadSquiffyScript = function () {
    localSave();
    downloadString(editor.getValue(), title + '.squiffy');
};

const downloadZip = async function () {
    localSave();
    const result = await compile(true);

    if (result.success) {
        const pkg = await createPackage(result, true);

        if (pkg.zip) {
            downloadUint8Array(pkg.zip, 'output.zip');
        }
    }
};

const downloadJavascript = async function () {
    localSave();
    const result = await compile(true);

    if (result.success) {
        const js = await result.getJs();
        downloadString(js, title + '.js');
    }
};

const downloadString = function (data: string, filename: string) {
    const blobData = new TextEncoder().encode(data).buffer;
    const blob = new Blob([blobData], { type: 'text/plain' });
    downloadBlob(blob, filename);
};

const downloadUint8Array = function (data: Uint8Array, filename: string) {
    const blobData = new Uint8Array(data).buffer;
    const blob = new Blob([blobData], { type: 'application/octet-stream' });
    downloadBlob(blob, filename);
};

const downloadBlob = function (blob: Blob, filename: string) {
    const downloadLink = document.createElement('a');
    downloadLink.download = filename;
    downloadLink.href = window.URL.createObjectURL(blob);
    downloadLink.onclick = () => {
        document.body.removeChild(downloadLink);
    };
    downloadLink.style.display = 'none';
    document.body.appendChild(downloadLink);
    downloadLink.click();
};

const preview = async function () {
    window.open('/preview.html', '_blank');
};

window.addEventListener('message', async e => {
    if (e.data === 'preview-ready' && e.source) {
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
    var text;

    if (isSection) {
        text = '[[' + selection + ']]';
    }
    else {
        text = '[' + selection + ']';
    }

    if (selection) {
        // replace the selected text with a link to new section/passage
        editor.replaceSelectedText(text);
    }

    text = text + ':\n';

    var insertLine = currentSection!.end!;
    var moveToLine = insertLine;
    if (!insertLine) {
        // adding new section/passage to the end of the document
        insertLine = editor.getLineCount();
        text = '\n\n' + text;
        moveToLine = insertLine + 1;
    }
    else {
        // adding new section/passage in the middle of the document
        text = text + '\n\n';
    }

    editor.replaceLine(insertLine, text);

    if (selection) {
        // move cursor to new section/passage
        editor.moveTo(moveToLine + 1);
    }
    else {
        // no name was specified, so set cursor position to middle of [[ and ]]
        var column = isSection ? 2 : 1;
        editor.moveTo(moveToLine, column);
    }
};

const showSettings = function () {
    new Modal('#settings-dialog').show();
};

var localSaveTimeout: NodeJS.Timeout | undefined, autoSaveTimeout: NodeJS.Timeout | undefined;

const editorChange = async function () {
    if (loading) return;
    setInfo('');
    if (localSaveTimeout) clearTimeout(localSaveTimeout);
    localSaveTimeout = setTimeout(localSave, 50);
    if (autoSaveTimeout) clearTimeout(autoSaveTimeout);
    autoSaveTimeout = setTimeout(autoSave, 5000);
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
    var data = editor.getValue();
    localStorage.squiffy = data;
    processFile(data);
};

const autoSave = function () {
    settings.autoSave(title);
};

const setInfo = function (text: string) {
    el<HTMLElement>('info').innerHTML = text;
};

const processFile = function (data: string) {
    var titleRegex = /^@title (.*)$/;
    var sectionRegex = /^\[\[(.*)\]\]:$/;
    var passageRegex = /^\[(.*)\]:$/;
    var newTitle;

    sourceMap = [
        {
            name: '(Default)',
            start: 0,
            isDefault: true,
            passages: [
                {
                    name: '(Default)',
                    start: 0,
                }
            ]
        }
    ];

    var lines = data.replace(/\r/g, '').split('\n');

    const currentSection = function () {
        return sourceMap.slice(-1)[0];
    };

    const endPassage = function (index: number) {
        var previousPassage = currentSection().passages.slice(-1)[0];
        if (!previousPassage) return;
        previousPassage.end = index;
    };

    lines.forEach(function (line, index) {
        var stripLine = line.trim();
        var titleMatch = titleRegex.exec(stripLine);
        var sectionMatch = sectionRegex.exec(stripLine);
        var passageMatch = passageRegex.exec(stripLine);

        if (titleMatch) {
            newTitle = titleMatch[1];
        }

        if (sectionMatch) {
            endPassage(index);
            currentSection().end = index;
            var newSection = {
                name: sectionMatch[1],
                start: index,
                passages: [
                    {
                        name: '(Default)',
                        start: index
                    }
                ]
            };
            sourceMap.push(newSection);
        }
        else if (passageMatch) {
            endPassage(index);
            var newPassage = {
                name: passageMatch[1],
                start: index
            };
            currentSection().passages.push(newPassage);
        }
    });

    if (!title || title !== newTitle) {
        title = newTitle || 'Untitled';
        if (settings.updateTitle) {
            settings.updateTitle(title);
        }
    }

    var selectSection = $('#sections');
    selectSection.html('');
    sourceMap.forEach(function (section) {
        var name = dropdownName(section.name);
        selectSection.append($('<option />').val(name).text(name));
    });

    cursorMoved(true);
};

const editorLoad = async function (data: string) {
    loading = true;
    editor.setValue(data);
    loading = false;
    localStorage.squiffy = data;
    processFile(data);
    await initialCompile();
};

const cursorMoved = function (force?: boolean) {
    var row = editor.getCurrentRow();
    if (!force && row == currentRow) return;
    if (!sourceMap) return;
    currentRow = row;

    var newCurrentSection: Section, newCurrentPassage: Passage;

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
        $('#sections').val(dropdownName(currentSection.name));
        $('#sections').trigger('chosen:updated');
        var selectPassage = $('#passages');
        selectPassage.html('');
        currentSection.passages.forEach(function (passage) {
            var name = dropdownName(passage.name);
            selectPassage.append($('<option />').val(name).text(name));
        });
    }

    if (newCurrentPassage! !== currentPassage) {
        currentPassage = newCurrentPassage!;
        $('#passages').val(dropdownName(currentPassage.name));
        $('#passages').trigger('chosen:updated');
    }
};

const dropdownName = function (name: string) {
    if (name.length === 0) return '(Master)';
    return name;
};

const sectionChanged = function () {
    var selectedSection = $('#sections').val();
    sourceMap.forEach(function (section) {
        if (dropdownName(section.name) === selectedSection) {
            editor.moveTo(section.start + (section.isDefault ? 0 : 1));
        }
    });
};

const passageChanged = function () {
    var selectedPassage = $('#passages').val();
    currentSection!.passages.forEach(function (passage) {
        if (dropdownName(passage.name) === selectedPassage) {
            editor.moveTo(passage.start + 1);
        }
    });
};

const init = async function (data: string) {
    const options: Settings = {
        data: data,
        autoSave: function () {
        },
        updateTitle: function (title: string) {
            document.title = title + ' - Squiffy Editor';
        },
        userSettings: userSettings
    };

    settings = options;

    initUserSettings();
    populateSettingsDialog();

    editor.init(options, editorChange, cursorMoved);

    await editorLoad(options.data);
    cursorMoved();

    onClick('restart', restart);
    onClick('back', goBack);
    onClick('file-new', () => editorLoad(""));
    onClick('open', () => openFile(editorLoad));
    onClick('save', () => saveFile(editor.getValue()));

    // TODO: Also do the clearTimeout thing?
    // if (options.save) {
    //     $('#save').show();
    //     $('#save').click(() => {
    //         clearTimeout(localSaveTimeout);
    //         localSave();
    //         options.save!(title!);
    //     });
    // }


    onClick('download-squiffy-script', downloadSquiffyScript);
    onClick('export-html-js', downloadZip);
    onClick('export-js', downloadJavascript);

    onClick('preview', preview);

    onClick('settings', showSettings);
    onClick('add-section', addSection);
    onClick('add-passage', addPassage);
    onClick('collapse-all', editor.collapseAll);
    onClick('uncollapse-all', editor.uncollapseAll);

    $('#sections').on('change', sectionChanged);
    $('#passages').on('change', passageChanged);
    $('#sections, #passages').chosen({ width: '100%' });
};

// load: function (data: string) {
//     editorLoad(data);
//     localSave();
// },
// save: function () {
//     return editor.getValue();
// },
// setInfo: function (text: string) {
//     setInfo(text);
// },
// run: run,
// selectAll: function () {
//     editor.selection.selectAll();
// },
// undo: function () {
//     editor.undo();
// },
// redo: function () {
//     editor.redo();
// },
// cut: function () {
//     var text = editor.getCopyText();
//     editor.session.replace(editor.selection.getRange(), '');
//     return text;
// },
// copy: function () {
//     return editor.getCopyText();
// },
// paste: function (text: string) {
//     editor.session.replace(editor.selection.getRange(), text);
// },
// find: function () {
//     editor.execCommand('find');
// },
// replace: function () {
//     editor.execCommand('replace');
// }

const setBackButtonEnabled = function(enabled: boolean) {
    const backButton = document.getElementById('back') as HTMLButtonElement | null;
    if (!backButton) return;
    backButton.disabled = !enabled;
}

const onCanGoBackChanged : SquiffyEventHandler<"canGoBackChanged"> = function (p) {
    setBackButtonEnabled(p.canGoBack);
}

const onSet = function (attribute: string, value: string) {
    // don't log internal attribute changes
    if (attribute.indexOf('_') === 0) return;

    logToDebugger(`${attribute} = ${value}`);
};

const logToDebugger = function (text: string) {
    const debuggerEl = el<HTMLElement>('debugger');
    debuggerEl.innerHTML += `${text}<br>`;
    debuggerEl.scrollTop = debuggerEl.scrollHeight;
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

    const outputContainer = el<HTMLElement>('output-container');
    outputContainer.innerHTML = '';
    const newOutput = document.createElement('div');
    newOutput.id = 'output';
    outputContainer.appendChild(newOutput);

    squiffyApi = await runtimeInit({
        element: newOutput,
        scroll: 'element',
        persist: false,
        onSet: onSet,
        story: story,
    });

    setBackButtonEnabled(false);
    squiffyApi.on('canGoBackChanged', onCanGoBackChanged);

    await squiffyApi.begin();
};

const showErrors = function (result: CompileError) {
    for (const err of result.errors) {
        logToDebugger(err);
    }
}

const showWarnings = function (warnings: string[]) {
    for (const warning of warnings) {
        logToDebugger(warning);
    }
};

// fail: function (data: string, msgs: string[]) {
//     $('<div/>', { id: 'output' }).appendTo('#output-container');

//     // Show fail message
//     $('#output').html(data.message);

//     // Show detailed info
//     this.showWarnings(msgs);
// }

var userSettings = {
    get: function (setting: string) {
        var value = localStorage.getItem(setting);
        if (value === null) return null;
        return JSON.parse(value);
    },
    set: function (setting: string, value: object) {
        localStorage.setItem(setting, JSON.stringify(value));
    }
};

document.addEventListener("DOMContentLoaded", async () => {
    const triggerTabList = document.querySelectorAll('#tabs button');
    triggerTabList.forEach(triggerEl => {
        const tabTrigger = new Tab(triggerEl);

        triggerEl.addEventListener('click', event => {
            event.preventDefault();
            tabTrigger.show();
        });
    });

    const tooltipTriggerList = document.querySelectorAll('[data-bs-toggle="tooltip"]');
    [...tooltipTriggerList].map(tooltipTriggerEl => new Tooltip(tooltipTriggerEl));

    var saved = localStorage.squiffy;
    if (saved) {
        await init(localStorage.squiffy);
    } else {
        await init('@title New Game\n\n' +
            'Start writing! You can delete all of this text, or play around with it if you\'re new to Squiffy.\n\n' +
            'Each choice is represented by a [[new section]]. You can create links to new sections by surrounding them ' +
            'in double square brackets.\n\n' +
            '[[new section]]:\n\nIn addition to sections, Squiffy has the concept of passages. These are sections of ' +
            'text that don\'t advance the story. Passage links use single square brackets. For example, you can click this [passage link], and this [other passage ' +
            'link], but the story won\'t advance until you click this [[section link]].\n\n' +
            '[passage link]:\n\nThis is the text for the first passage link.\n\n' +
            '[other passage link]:\n\nThis is the text for the second passage link.\n\n' +
            '[[section link]]:\n\nWhen a new section appears, any unclicked passage links from the previous section are disabled.');
    }
});

Split(['#left-pane', '#right-pane']);
Split(['#output-container', '#debugger'], {
    direction: 'vertical',
    sizes: [75, 25],
});

clearDebugger();