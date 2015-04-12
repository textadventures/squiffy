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

    var editor, settings, title, loading;

    var run = function () {
        $('#output-container').html('');
        $('#debugger').html('');
        $('#restart').hide();
        $('a[href="#tab-output"]').tab('show');
        settings.compile({
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
                $('#output').html(data.message);
            }
        });
    };

    var restart = function () {
        $('#debugger').html('');
        $('#output').squiffy('restart');
    };

    var downloadSquiffyScript = function () {
        localSave();
        download(editor.getValue(), title + '.squiffy');
    };

    var downloadZip = function () {
        localSave();
        settings.compile({
            data: editor.getValue(),
            success: function (data) {
                download(data, title + '.zip', 'application/octet-stream');
            },
            fail: function (data) {
                $('#output').html(data.message);
            },
            zip: true
        });
    };

    var downloadJavascript = function () {
        localSave();
        settings.compile({
            data: editor.getValue(),
            success: function (data) {
                download(data, title + '.js');
            },
            fail: function (data) {
                $('#output').html(data.message);
            }
        });
    };

    var download = function (data, filename, type) {
        var blob = new Blob([data], {type: type || 'text/plain'});
        var downloadLink = document.createElement('a');
        downloadLink.download = filename;
        downloadLink.href = window.URL.createObjectURL(blob);
        downloadLink.onclick = function (e) {
            document.body.removeChild(e.target);
        };
        downloadLink.style.display = 'none';
        document.body.appendChild(downloadLink);
        downloadLink.click();
    };

    var localSaveTimeout, autoSaveTimeout;

    var editorChange = function () {
        if (loading) return;
        setInfo('');
        if (localSaveTimeout) clearTimeout(localSaveTimeout);
        localSaveTimeout = setTimeout(localSave, 1000);
        if (settings.autoSave) {
            if (autoSaveTimeout) clearTimeout(autoSaveTimeout);
            autoSaveTimeout = setTimeout(autoSave, 5000);
        }
    };

    var localSave = function () {
        var data = editor.getValue();
        if (settings.storageKey) {
            localStorage[settings.storageKey] = data;
            setInfo('All changes saved locally');
        }
        processFile(data);
    };

    var autoSave = function () {
        settings.autoSave(title);
    };

    var setInfo = function (text) {
        $('#info').html(text);
    };

    var processFile = function (data) {
        var titleRegex = /^@title (.*)$/;
        var newTitle;

        var lines = data.replace(/\r/g, '').split('\n');
        lines.forEach(function (line) {
            var stripLine = line.trim();
            var match = titleRegex.exec(stripLine);

            if (match) {
                newTitle = match[1];
            }
        });

        if (!title || title !== newTitle) {
            title = newTitle || 'Untitled';
            if (settings.updateTitle) {
                settings.updateTitle(title);
            }
        }
    };

    var editorLoad = function (data) {
        loading = true;
        editor.getSession().setValue(data, -1);
        loading = false;
        processFile(data);
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

            editorLoad(options.data);

            if (options.open) {
                $('#open').show();
                $('#open').click(options.open);
            }

            if (options.save) {
                $('#save').show();
                $('#save').click(function () {
                    clearTimeout(localSaveTimeout);
                    localSave();
                    options.save(title);
                });
            }

            if (options.preview) {
                $('#preview').show();
                $('#preview').click(options.preview);
            }

            if (options.publish) {
                $('#publish').show();
                $('#publish').click(options.publish);
            }

            $('#run').click(run);
            $('#restart').click(restart);
            $('#download-squiffy-script').click(downloadSquiffyScript);
            $('#export-html-js').click(downloadZip);
            $('#export-js').click(downloadJavascript);
        },
        load: function (data) {
            editorLoad(data);
            localSave();
        },
        save: function () {
            return editor.getValue();
        },
        setStorageKey: function (key) {
            settings.storageKey = key;
        },
        setInfo: function (text) {
            setInfo(text);
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
        '<div class="ui-layout-north">\
            <button id="open" class="btn btn-primary" style="display: none"><span class="glyphicon glyphicon-open-file"></span> Open</button>\
            <button id="save" class="btn btn-primary" style="display: none"><span class="glyphicon glyphicon-cloud-upload"></span> Save</button>\
            <button id="run" class="btn btn-success"><span class="glyphicon glyphicon-play"></span> Run</button>\
            <button id="restart" class="btn btn-success" style="display: none"><span class="glyphicon glyphicon-refresh"></span> Restart</button>\
            <span id="info"></span>\
            <div style="float: right">\
                <div class="btn-group">\
                        <button class="btn btn-primary dropdown-toggle" data-toggle="dropdown" aria-expanded="false">\
                            <span class="glyphicon glyphicon-cloud-download"></span>\
                            Download\
                            <span class="caret"></span>\
                        </button>\
                        <ul class="dropdown-menu" role="menu">\
                            <li><a id="download-squiffy-script">Squiffy script</a></li>\
                            <li><a id="export-html-js">Export HTML and JavaScript</a></li>\
                            <li><a id="export-js">Export JavaScript only</a></li>\
                        </ul>\
                </div>\
                <button id="preview" class="btn btn-primary" style="display: none"><span class="glyphicon glyphicon-eye-open"></span> Preview</button>\
                <button id="publish" class="btn btn-primary" style="display: none"><span class="glyphicon glyphicon-circle-arrow-up"></span> Publish</button>\
            </div>\
        </div>\
        <div class="ui-layout-center">\
            <div id="editor"></div>\
        </div>\
        <div class="ui-layout-east">\
            <ul class="nav nav-tabs">\
                <li class="active"><a href="#tab-help" role="tab" data-toggle="tab">Help</a></li>\
                <li><a href="#tab-output" role="tab" data-toggle="tab">Output</a></li>\
            </ul>\
            <div class="tab-content">\
                <div role="tabpanel" class="tab-pane active" id="tab-help">\
                    To create a new section:\
                    <pre>[[new section]]:</pre>\
                    To link to a section:\
                    <pre>Link [[like this]] or [[use different link text]](new section)</pre>\
                    To create a new passage:\
                    <pre>[new passage]:</pre>\
                    To link to a passage:\
                    <pre>Link [like this] or [use different link text](new passage)</pre>\
                    <a href="http://docs.textadventures.co.uk/squiffy/" target="_blank">Full documentation</a>\
                </div>\
                <div role="tabpanel" class="tab-pane" id="tab-output">\
                    <div id="output-container">\
                        <div id="output">\
                            Click the Run button to start the game.\
                        </div>\
                    </div>\
                </div>\
            </div>\
        </div>\
        <div class="ui-layout-south">\
            <div id="debugger"></div>\
        </div>\n';
})();