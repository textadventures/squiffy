import 'bootstrap/scss/bootstrap.scss';
import 'bootstrap-icons/font/bootstrap-icons.css'
import 'chosen-js/chosen.min.css'
import Split from 'split.js'

import $ from 'jquery';

(window as any).$ = $;
(window as any).jQuery = $;

import "chosen-js/chosen.jquery.js"
import { Modal, Tab, Tooltip } from 'bootstrap'
import { Output, compile as squiffyCompile } from 'squiffy-compiler';
import { openFile, saveFile } from './file-handler';
import { Settings } from './settings';
import * as editor from './editor';
import { init as runtimeInit, SquiffyApi } from 'squiffy-runtime';

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

const run = async function () {
    el<HTMLElement>('output').innerHTML = '';
    el<HTMLElement>('debugger').innerHTML = '';
    el<HTMLButtonElement>('restart').hidden = true;

    await compile();
};

const restart = function () {
    el<HTMLElement>('debugger').innerHTML = '';
    $('#output').squiffy('restart');
};

const downloadSquiffyScript = function () {
    localSave();
    download(editor.getValue(), title + '.squiffy');
};

// const downloadZip = async function () {
//     localSave();
//     await settings.compile({
//         data: editor.getValue(),
//         success: function (data) {
//             download(data, title + '.zip', 'application/octet-stream');
//         },
//         fail: function (data) {
//             $('#output').html(data.message);
//         },
//         zip: true
//     });
// };

// const downloadJavascript = async function () {
//     localSave();
//     await settings.compile({
//         data: editor.getValue(),
//         success: function (data) {
//             download(data, title + '.js');
//         },
//         fail: function (data) {
//             $('#output').html(data.message);
//         }
//     });
// };

const download = function (data: string, filename: string, type?: string) {
    var blob = new Blob([data], { type: type || 'text/plain' });
    var downloadLink = document.createElement('a');
    downloadLink.download = filename;
    downloadLink.href = window.URL.createObjectURL(blob);
    downloadLink.onclick = () => {
        document.body.removeChild(downloadLink);
    };
    downloadLink.style.display = 'none';
    document.body.appendChild(downloadLink);
    downloadLink.click();
};

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

    if (squiffyApi) {
        const result = await squiffyCompile({
            scriptBaseFilename: "filename.squiffy",
            script: editor.getValue(),
        });

        if (result.success) {
            const js = result.output.js.map(jsLines => new Function('squiffy', 'get', 'set', jsLines.join('\n')));
            const story = {
                js: js as any,
                ...result.output.story,
            };

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

const editorLoad = function (data: string) {
    loading = true;
    editor.setValue(data);
    loading = false;
    localStorage.squiffy = data;
    processFile(data);
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

const init = function (data: string) {
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

    editorLoad(options.data);
    cursorMoved();

    // if (options.preview) {
    //     $('#preview').show();
    //     $('#preview').click(options.preview);
    // }

    // if (options.publish) {
    //     $('#publish').show();
    //     $('#publish').click(options.publish);
    // }

    // if (options.build) {
    //     $('#build').show();
    //     $('#build').click(options.build);
    // }

    onClick('run', run);
    onClick('restart', restart);
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
    // $('#export-html-js').click(downloadZip);
    // $('#export-js').click(downloadJavascript);

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

const onSet = function (attribute: string, value: string) {
    // don't log internal attribute changes
    if (attribute.indexOf('_') === 0) return;

    logToDebugger(`${attribute} = ${value}`);
};

const logToDebugger = function (text: string) {
    el<HTMLElement>('debugger').innerHTML += `${text}<br>`;
};

const compile = async function () {
    const script = editor.getValue();

    const result = await squiffyCompile({
        scriptBaseFilename: "filename.squiffy",
        script: script,
    });

    if (!result.success) {
        // TODO
        // onCompileFail(result, []);
        return;
    }

    // TODO: Pass array of errors/warnings as the second parameter
    await onCompileSuccess(result.output, []);

    // TODO: Handle zip request (input.zip previously called "/zip" on server version)
};

const onCompileSuccess = async function (data: Output, msgs: string[]) {
    el<HTMLButtonElement>('restart').hidden = false;

    showWarnings(msgs);

    const js = data.js.map(jsLines => new Function('squiffy', 'get', 'set', jsLines.join('\n')));

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
        story: {
            js: js as any,
            ...data.story,
        },
    });

    await squiffyApi.begin();
};

// fail: function (data: string, msgs: string[]) {
//     $('<div/>', { id: 'output' }).appendTo('#output-container');

//     // Show fail message
//     $('#output').html(data.message);

//     // Show detailed info
//     this.showWarnings(msgs);
// }

const showWarnings = function (msgs: string[]) {
    const WarningStyle = '"color: gold; background-color: gray"';

    if (msgs.length > 0) {
        el<HTMLElement>('output').innerHTML = '<div style=' + WarningStyle + '>' + msgs + '</div>';
    }

    return;
};

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

document.addEventListener("DOMContentLoaded", () => {
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
        init(localStorage.squiffy);
    } else {
        init('@title New Game\n\n' +
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