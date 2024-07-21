import { getJs } from "./compiler/compiler";

$(function() {

    var compile = function (input) {
        const result = getJs(input.data, input.template);
        console.log(result);

        // var url = 'http://squiffy.textadventures.co.uk';

        // if (input.zip) {
        //     // Using XMLHttpRequest here as jQuery doesn't support blob downloads
        //     url += '/zip';
        //     var xhr = new XMLHttpRequest();
        //     xhr.open('POST', url, true);
        //     xhr.responseType = 'blob';

        //     xhr.onload = function (e) {
        //         if (this.status == 200) {
        //             input.success(this.response);
        //         }
        //         else {
        //             input.fail(this.response);
        //         }
        //     };

        //     xhr.send(input.data);
        //     return;
        // }

        // $.ajax({
        //     url: url,
        //     data: input.data,
        //     type: "POST",
        //     success: function (data) {
        //         if (data.indexOf('Failed') === 0) {
        //             input.fail(data);
        //             return;
        //         }
        //         input.success(data);
        //     },
        //     error: function (xhr, status, err) {
        //         input.fail({
        //             message: err
        //         });
        //     }
        // });
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