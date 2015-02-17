/* jshint quotmark: single */
/* jshint evil: true */

(function () {
    'use strict';

    String.prototype.format = function() {
        var args = arguments;
        return this.replace(/{(\d+)}/g, function(match, number) { 
            return typeof args[number] != 'undefined' ? args[number] : match;
        });
    };

    var editor, settings;

    var run = function () {
        $('#output-container').html('');
        $('#debugger').html('');
        $('#restart').hide();
        var result = settings.compile({
            data: editor.getValue(),
            success: function (data) {
                $('#restart').show();

                $('<div/>', { id: 'output' })
                .appendTo('#output-container');

                $('<hr/>').appendTo('#output-container');

                if (data.indexOf('Failed') === 0) {
                    $('#output').html(data);
                    return;
                }

                eval(data);
                $('#output').squiffy({
                    scroll: 'element',
                    persist: false,
                    restartPrompt: false,
                    onSet: function (attribute, value) {
                        onSet(attribute, value);
                    }
                });
            },
            fail: function (data) {
                $('#output').html(result.message);
            }
        });
    };

    var restart = function () {
        $('#debugger').html('');
        $('#output').squiffy('restart');
    };

    var localSaveTimeout;

    var editorChange = function () {
        if (localSaveTimeout) clearTimeout(localSaveTimeout);
        localSaveTimeout = setTimeout(localSave, 1000);
    };

    var localSave = function () {
        if (settings.storageKey) {
            localStorage[settings.storageKey] = editor.getValue();
        }
    };

    var methods = {
        init: function (options) {
            var element = this;
            settings = options;

            element.html(editorHtml);
            element.layout({
                applyDefaultStyles: true,
                onresize: function () {
                    if (editor) editor.resize();
                },
                north__resizable: false,
                north__closable: false,
                north__spacing_open: 0,
                east__size: 0.5,
                south__size: 80,
            });
            
            editor = ace.edit('editor');
            editor.setTheme('ace/theme/eclipse');
            editor.getSession().setMode('ace/mode/markdown');
            editor.getSession().setUseWrapMode(true);
            editor.getSession().on('change', editorChange);
            editor.focus();

            editor.getSession().setValue(options.data, -1);

            if (options.open) {
                $('#open').show();
                $('#open').click(options.open);
            }

            if (options.save) {
                $('#save').show();
                $('#save').click(options.save);
            }

            $('#run').click(run);
            $('#restart').click(restart);
        },
        load: function (data) {
            editor.getSession().setValue(data, -1);
        },
        setStorageKey: function (key) {
            settings.storageKey = key;
        },
    };

    $.fn.squiffyEditor = function (methodOrOptions) {
        if (methods[methodOrOptions]) {
            return methods[methodOrOptions].apply(this, Array.prototype.slice.call(arguments, 1));
        }
        else if (typeof methodOrOptions === 'object' || ! methodOrOptions) {
            return methods.init.apply(this, arguments);
        } else {
            $.error('Method ' +  methodOrOptions + ' does not exist');
        }
    };

    var onSet = function (attribute, value) {
        // don't log internal attribute changes
        if (attribute.indexOf('_') === 0) return;

        $('<p/>').html('{0} = {1}'.format(attribute, value)).appendTo('#debugger');
    };

    var editorHtml = 
        '<div class="ui-layout-north">\n' +
            '<button id="open" class="btn btn-primary" style="display: none"><span class="glyphicon glyphicon-open-file"></span> Open</button>\n' +
            '<button id="save" class="btn btn-primary" style="display: none"><span class="glyphicon glyphicon-save"></span> Save</button>\n' +
            '<button id="run" class="btn btn-success"><span class="glyphicon glyphicon-play"></span> Run</button>\n' +
            '<button id="restart" class="btn btn-success" style="display: none"><span class="glyphicon glyphicon-refresh"></span> Restart</button>\n' +
            '<div style="float: right">\n' +
                '<div class="btn-group">\n' +
                        '<button class="btn btn-primary dropdown-toggle" data-toggle="dropdown" aria-expanded="false">\n' +
                                '<span class="glyphicon glyphicon-cloud-download"></span>\n' +
                                'Download\n' +
                                '<span class="caret"></span>\n' +
                        '</button>\n' +
                        '<ul class="dropdown-menu" role="menu">\n' +
                                '<li><a href="#">Squiffy script</a></li>\n' +
                                '<li><a href="#">Export HTML and JavaScript</a></li>\n' +
                                '<li><a href="#">Export JavaScript only</a></li>\n' +
                        '</ul>\n' +
                '</div>\n' +
                '<button id="preview" class="btn btn-primary"><span class="glyphicon glyphicon-eye-open"></span> Preview</button>\n' +
                '<button id="publish" class="btn btn-primary"><span class="glyphicon glyphicon-circle-arrow-up"></span> Publish</button>\n' +
            '</div>\n' +
        '</div>\n' +
        '<div class="ui-layout-center">\n' +
            '<div id="editor"></div>\n' +
        '</div>\n' +
        '<div class="ui-layout-east">\n' +
            '<div id="output-container"></div>\n' +
        '</div>\n' +
        '<div class="ui-layout-south">\n' +
            '<div id="debugger"></div>\n' +
        '</div>\n';
})();