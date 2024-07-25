import './scss/styles.scss'
import 'bootstrap-icons/font/bootstrap-icons.css'
import 'chosen-js/chosen.min.css'

import $ from 'jquery';
import { Modal, Tab, Tooltip } from 'bootstrap'
import { getJs } from "./compiler";
import { init as initAce } from "./squiffy-ace";
import { openFile } from './file-handler';

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

interface Settings {
    userSettings: any;
    autoSave: (arg0: any) => void;
    updateTitle: (arg0: string) => void;
    data: string;
}

var editor: AceAjax.Editor;
var settings: Settings;
var title: string | undefined;
var loading: boolean;
var sourceMap: Section[];
var currentRow: any;
var currentSection: Section | null;
var currentPassage: Passage | null;

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
        editor.setFontSize(`${val}px`);
        us.set('fontSize', val);
        fontSizeElement.value = val;
    });
};

const run = async function () {
    el<HTMLElement>('output').innerHTML = '';
    el<HTMLElement>('debugger').innerHTML = '';
    el<HTMLButtonElement>('restart').hidden = true;

    const tabOutputButton = document.querySelector('#tab-output-button');
    Tab.getInstance(tabOutputButton!)!.show();

    await compile();
};

const restart = function () {
    el<HTMLElement>('debugger').innerHTML = '';
    $('#output').squiffy('restart');
};

// const downloadSquiffyScript = function () {
//     localSave();
//     download(editor.getValue(), title + '.squiffy');
// };

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

// const download = function (data, filename, type) {
//     var blob = new Blob([data], { type: type || 'text/plain' });
//     var downloadLink = document.createm('a');
//     downloadLink.download = filename;
//     downloadLink.href = window.URL.createObjectURL(blob);
//     downloadLink.onclick = function (e) {
//         document.body.removeChild(e.target);
//     };
//     downloadLink.style.display = 'none';
//     document.body.appendChild(downloadLink);
//     downloadLink.click();
// };

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
        editor.session.replace(editor.selection.getRange(), text);
    }

    text = text + ':\n';

    var insertLine = currentSection!.end!;
    var moveToLine = insertLine;
    if (!insertLine) {
        // adding new section/passage to the end of the document
        insertLine = editor.session.doc.getAllLines().length;
        text = '\n\n' + text;
        moveToLine = insertLine + 1;
    }
    else {
        // adding new section/passage in the middle of the document
        text = text + '\n\n';
    }

    var Range = ace.require('ace/range').Range;
    var range = new Range(insertLine, 0, insertLine, 0);
    editor.session.replace(range, text);

    if (selection) {
        // move cursor to new section/passage
        moveTo(moveToLine + 1);
    }
    else {
        // no name was specified, so set cursor position to middle of [[ and ]]
        var column = isSection ? 2 : 1;
        moveTo(moveToLine, column);
    }
};

const collapseAll = function () {
    editor.session.foldAll();
};

const uncollapseAll = function () {
    editor.session.unfold(null, true);
};

const showSettings = function () {
    new Modal('#settings-dialog').show();
};

var localSaveTimeout: number | undefined, autoSaveTimeout: number | undefined;

const editorChange = function () {
    if (loading) return;
    setInfo('');
    if (localSaveTimeout) clearTimeout(localSaveTimeout);
    localSaveTimeout = setTimeout(localSave, 50);
    if (autoSaveTimeout) clearTimeout(autoSaveTimeout);
    autoSaveTimeout = setTimeout(autoSave, 5000);
    // TODO: Show some indicator that the current file has not been saved
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
    editor.getSession().setValue(data);
    loading = false;
    processFile(data);
};

const cursorMoved = function (force?: boolean) {
    var row = editor.selection.getCursor().row;
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
            moveTo(section.start + (section.isDefault ? 0 : 1));
        }
    });
};

const passageChanged = function () {
    var selectedPassage = $('#passages').val();
    currentSection!.passages.forEach(function (passage) {
        if (dropdownName(passage.name) === selectedPassage) {
            moveTo(passage.start + 1);
        }
    });
};

const moveTo = function (row: number, column?: number) {
    column = column || 0;
    var Range = ace.require('ace/range').Range;
    editor.selection.setRange(new Range(row, column, row, column), false);
    editor.renderer.scrollCursorIntoView();
    editor.focus();
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

    editor = ace.edit('editor');

    // get rid of an annoying warning
    editor.$blockScrolling = Infinity;

    initAce();

    editor.setTheme('ace/theme/squiffy');
    editor.getSession().setMode('ace/mode/squiffy');
    editor.getSession().setUseWrapMode(true);
    editor.setShowPrintMargin(false);
    editor.getSession().on('change', editorChange);
    editor.on('changeSelection', function () {
        cursorMoved();
    });
    editor.commands.removeCommand('goToNextError');
    editor.commands.removeCommand('goToPreviousError');
    editor.commands.removeCommand('showSettingsMenu');

    editor.setFontSize(options.userSettings.get('fontSize'));
    editor.focus();

    editorLoad(options.data);
    cursorMoved();

    // if (options.open) {
    //     $('#open').show();
    //     $('#open').click(options.open);
    // }

    // if (options.save) {
    //     $('#save').show();
    //     $('#save').click(() => {
    //         clearTimeout(localSaveTimeout);
    //         localSave();
    //         options.save!(title!);
    //     });
    // }

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
    onClick('open', () => openFile(editorLoad));

    // $('#download-squiffy-script').click(downloadSquiffyScript);
    // $('#export-html-js').click(downloadZip);
    // $('#export-js').click(downloadJavascript);

    onClick('settings', showSettings);
    onClick('add-section', addSection);
    onClick('add-passage', addPassage);
    onClick('collapse-all', collapseAll);
    onClick('uncollapse-all', uncollapseAll);

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
    const result = await getJs(editor.getValue());

    // TODO: Pass array of errors/warnings as the second parameter
    onCompileSuccess(result, []);

    // TODO: Handle zip request (input.zip previously called "/zip" on server version)
};

const onCompileSuccess = function (data: string, msgs: string[]) {
    el<HTMLButtonElement>('restart').hidden = false;

    const output = el<HTMLElement>('output');

    showWarnings(msgs);
    // Show output
    if (data.indexOf('Failed') === 0) {
        output.innerHTML = data;
        return;
    }

    try {
        eval(data);
    }
    catch (e) {
        output.innerHTML = e as string;
        return;
    }

    const outputContainer = el<HTMLElement>('output-container');
    outputContainer.innerHTML = '';
    const newOutput = document.createElement('div');
    newOutput.id = 'output';
    outputContainer.appendChild(newOutput);

    $(newOutput).squiffy({
        scroll: 'element',
        persist: false,
        restartPrompt: false,
        onSet: function (attribute: string, value: string) {
            onSet(attribute, value);
        }
    });
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