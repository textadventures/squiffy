import { getJs } from "./compiler";

$(function() {

    var compile = function (input) {
        const result = getJs(input.data, input.template);

        // TODO: Pass array of errors/warnings as the second parameter
        input.success(result, []);

        // TODO: Handle zip request (input.zip previously called "/zip" on server version)
    };

    var userSettings = {
        get: function (setting) {
            var value = localStorage.getItem(setting);
            if (value === null) return null;
            return JSON.parse(value);
        },
        set: function (setting, value) {
            localStorage.setItem(setting, JSON.stringify(value));
        }
    };

    var init = function (data, storageKey) {
        setTimeout(function () {
            $('#squiffy-editor').squiffyEditor({
                data: data,
                compile: compile,
                autoSave: function () {
                },
                storageKey: storageKey || 'squiffy',
                updateTitle: function (title) {
                    document.title = title + ' - Squiffy Editor';
                },
                download: true,
                userSettings: userSettings
            });
        }, 1);
    };

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