/* jshint quotmark: single */
/* jshint evil: true */
/* jshint multistr: true */

(function () {
    'use strict';

    String.prototype.format = function() {
        var args = arguments;
        return this.replace(/{(\d+)}/g, function(match, number) { 
            return typeof args[number] != 'undefined' ? args[number] : match;
        });
    };

    var editor, settings, title, loading, layout, sourceMap,
        currentRow, currentSection, currentPassage;
    
    var defaultSettings = {
      fontSize: 12
    };
    
    var initUserSettings = function () {
      var us = settings.userSettings;
      var fontSize = us.get('fontSize');
      if (!fontSize) {
        us.set('fontSize', defaultSettings.fontSize);
      }
    };
    
    var populateSettingsDialog = function () {
      var us = settings.userSettings;
      $('#font-size').val(us.get('fontSize'));
      $('#font-size').change(function () {
        var val = parseInt($('#font-size').val());
        if (!val) val = defaultSettings.fontSize;
        editor.setFontSize(val);
        us.set('fontSize', val);
        $('#font-size').val(val);
      });
    };

    var run = function () {
        $('#output-container').html('');
        $('#debugger').html('');
        $('#restart').hide();
        $('a[href="#tab-output"]').tab('show');
        settings.compile({
            data: editor.getValue(),
            success: function (data) {
                $('#restart').show();

                $('<div/>', { id: 'output' }).appendTo('#output-container');

                $('<hr/>').appendTo('#output-container');

                if (data.indexOf('Failed') === 0) {
                    $('#output').html(data);
                    return;
                }

                try {
                    eval(data);
                }
                catch (e) {
                    $('#output').html(e);
                    return;
                }
                
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
                $('<div/>', { id: 'output' }).appendTo('#output-container');
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
    
    var showSettings = function () {
      $('#settings-dialog').modal();
    };

    var localSaveTimeout, autoSaveTimeout;

    var editorChange = function () {
        if (loading) return;
        setInfo('');
        if (localSaveTimeout) clearTimeout(localSaveTimeout);
        localSaveTimeout = setTimeout(localSave, 50);
        if (settings.autoSave) {
            if (autoSaveTimeout) clearTimeout(autoSaveTimeout);
            autoSaveTimeout = setTimeout(autoSave, 5000);
        }
        if (settings.setDirty) settings.setDirty();
    };

    var localSave = function () {
        var data = editor.getValue();
        if (settings.storageKey) {
            localStorage[settings.storageKey] = data;
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
        var lineCount = 0;

        var currentSection = function () {
            return sourceMap.slice(-1)[0];
        };

        var endPassage = function (index) {
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

    var editorLoad = function (data) {
        loading = true;
        editor.getSession().setValue(data, -1);
        loading = false;
        processFile(data);
    };

    var cursorMoved = function (force) {
        var row = editor.selection.getCursor().row;
        if (!force && row == currentRow) return;
        if (!sourceMap) return;
        currentRow = row;

        var newCurrentSection, newCurrentPassage;

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

        if (newCurrentSection !== currentSection) {
            currentSection = newCurrentSection;
            $('#sections').val(dropdownName(currentSection.name));
            $('#sections').trigger('chosen:updated');
            var selectPassage = $('#passages');
            selectPassage.html('');
            currentSection.passages.forEach(function (passage) {
                var name = dropdownName(passage.name);
                selectPassage.append($('<option />').val(name).text(name));
            });
        }

        if (newCurrentPassage !== currentPassage) {
            currentPassage = newCurrentPassage;
            $('#passages').val(dropdownName(currentPassage.name));
            $('#passages').trigger('chosen:updated');
        }
    };

    var dropdownName = function (name) {
        if (name.length === 0) return '(Master)';
        return name;
    };

    var sectionChanged = function () {
        var selectedSection = $('#sections').val();
        sourceMap.forEach(function (section) {
            if (dropdownName(section.name) === selectedSection) {
                moveTo(section.start + (section.isDefault ? 0 : 1));
            }
        });
    };

    var passageChanged = function () {
        var selectedPassage = $('#passages').val();
        currentSection.passages.forEach(function (passage) {
            if (dropdownName(passage.name) === selectedPassage) {
                moveTo(passage.start + 1);
            }
        });
    };

    var moveTo = function (row) {
        var Range = ace.require('ace/range').Range;
        editor.selection.setRange(new Range(row, 0, row, 0));
        editor.renderer.scrollCursorIntoView();
        editor.focus();
    };

    var methods = {
        init: function (options) {
            var element = this;
            settings = options;

            if (options.desktop) {
                editorHtml = editorHtml.replace('glyphicon-cloud-upload', 'glyphicon-floppy-disk');
            }

            element.html(editorHtml);
            $('body').append(appendHtml);
            
            initUserSettings();
            populateSettingsDialog();
            
            layout = element.layout({
                applyDefaultStyles: true,
                north__resizable: false,
                north__closable: false,
                north__spacing_open: 0,
                east__size: 0.5,
                south__size: 80,
                south__initClosed: true,
                center__spacing_open: 0, 
            });

            $('#inner-layout').layout({
                onresize: function () {
                    if (editor) editor.resize();
                },
                north__resizable: false,
                north__closable: false,
                center__spacing_open: 0,
            });
            
            editor = ace.edit('editor');
            
            // get rid of an annoying warning
            editor.$blockScrolling = Infinity;

            editor.setTheme('ace/theme/eclipse');
            
            define('ace/mode/squiffy', [], function(require, exports, module) {             
              var oop = require("ace/lib/oop");
              var MarkdownMode = require("ace/mode/markdown").Mode;
              var MarkdownHighlightRules = require("ace/mode/markdown_highlight_rules").MarkdownHighlightRules;
              
              var Mode = function() {
                this.HighlightRules = SquiffyHighlightRules;
              };
              oop.inherits(Mode, MarkdownMode);
              exports.Mode = Mode;
              
              var SquiffyHighlightRules = function () {
                this.$rules = new MarkdownHighlightRules().getRules();
                console.log(this.$rules);
              };
              oop.inherits(SquiffyHighlightRules, MarkdownHighlightRules);
              exports.SquiffyHighlightRules = SquiffyHighlightRules;
            });
            
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

            if (options.download) {
                $('#download').show();
            }

            if (options.build) {
                $('#build').show();
                $('#build').click(options.build);
            }

            $('#run').click(run);
            $('#restart').click(restart);
            $('#download-squiffy-script').click(downloadSquiffyScript);
            $('#export-html-js').click(downloadZip);
            $('#export-js').click(downloadJavascript);
            $('#settings').click(showSettings);
            $('#sections').on('change', sectionChanged);
            $('#passages').on('change', passageChanged);
            $('#sections, #passages').chosen();
            $('[data-toggle="tooltip"]').tooltip();
            $('#settings-dialog').keypress(function (e) {
              if (e.which === 13) {
                $('#settings-dialog').modal('hide');
              }
            });
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
        run: run,
        selectAll: function () {
            editor.selection.selectAll();
        },
        undo: function () {
            editor.undo();
        },
        redo: function () {
            editor.redo();
        },
        cut: function () {
            var text = editor.getSelectedText();
            editor.session.replace(editor.selection.getRange(), '');
            return text;
        },
        copy: function () {
            return editor.getSelectedText();
        },
        paste: function (text) {
            editor.session.replace(editor.selection.getRange(), text);
        },
        find: function () {
            editor.execCommand('find');
        },
        replace: function () {
            editor.execCommand('replace');
        }
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

        logToDebugger('{0} = {1}'.format(attribute, value));
    };

    var logToDebugger = function (text) {
        layout.open('south');
        $('#debugger').append(text + '<br/>');
        $('#debugger').scrollTop($('#debugger').height());
    };

    var editorHtml = 
        '<div class="ui-layout-north">\
            <button id="open" class="btn btn-primary" style="display: none"><span class="glyphicon glyphicon-folder-open"></span> Open</button>\
            <button id="save" class="btn btn-primary" style="display: none"><span class="glyphicon glyphicon-cloud-upload"></span> Save</button>\
            <button id="run" class="btn btn-success"><span class="glyphicon glyphicon-play"></span> Run</button>\
            <button id="restart" class="btn btn-success" style="display: none"><span class="glyphicon glyphicon-refresh"></span> Restart</button>\
            <span id="info"></span>\
            <div style="float: right">\
                <div class="btn-group">\
                        <button id="download" class="btn btn-primary dropdown-toggle" style="display: none" data-toggle="dropdown" aria-expanded="false">\
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
                <button id="settings" class="btn btn-default" data-toggle="tooltip" data-placement="bottom" title="Settings"><span class="glyphicon glyphicon-cog"></span></button>\
                <button id="preview" class="btn btn-primary" style="display: none"><span class="glyphicon glyphicon-eye-open"></span> Preview</button>\
                <button id="publish" class="btn btn-primary" style="display: none"><span class="glyphicon glyphicon-circle-arrow-up"></span> Publish</button>\
                <button id="build" class="btn btn-primary" style="display: none"><span class="glyphicon glyphicon-flash"></span> Build</button>\
            </div>\
        </div>\
        <div class="ui-layout-center" id="inner-layout">\
            <div class="ui-layout-north">\
                <div class="row">\
                    <div class="col-xs-6">\
                        <select id="sections" class="form-control input-sm" />\
                    </div>\
                    <div class="col-xs-6">\
                        <select id="passages" class="form-control input-sm" />\
                    </div>\
                </div>\
            </div>\
            <div class="ui-layout-center">\
                <div id="editor"></div>\
            </div>\
        </div>\
        <div class="ui-layout-east">\
            <ul class="nav nav-tabs">\
                <li class="active"><a href="#tab-help" role="tab" data-toggle="tab">Help</a></li>\
                <li><a href="#tab-output" role="tab" data-toggle="tab">Output</a></li>\
            </ul>\
            <div class="tab-content">\
                <div role="tabpanel" class="tab-pane active" id="tab-help">\
                    You can format your text using HTML and\
                    <a href="http://daringfireball.net/projects/markdown/syntax" class="external-link" target="_blank">\
                    Markdown</a>.<br/><br/>\
                    To create a new section:\
                    <pre>[[new section]]:</pre>\
                    To link to a section:\
                    <pre>Link [[like this]] or [[use different link text]](new section)</pre>\
                    To create a new passage:\
                    <pre>[new passage]:</pre>\
                    To link to a passage:\
                    <pre>Link [like this] or [use different link text](new passage)</pre>\
                    <a href="http://docs.textadventures.co.uk/squiffy/" class="external-link" target="_blank">Full documentation</a>\
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
        </div>\
        ';
      var appendHtml =
        '<div class="modal fade" id="settings-dialog" tabindex="-1" role="dialog" aria-labelledby="settingsLabel">\
          <div class="modal-dialog" role="document">\
            <div class="modal-content">\
              <div class="modal-header">\
                <button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button>\
                <h4 class="modal-title" id="settingsLabel">Settings</h4>\
              </div>\
              <div class="modal-body">\
                <div class="form-horizontal">\
                  <div class="form-group">\
                    <label for="font-size" class="col-sm-2 control-label">Font Size</label>\
                    <div class="col-sm-10">\
                      <input type="number" class="form-control" id="font-size" />\
                    </div>\
                  </div>\
                </div>\
              </div>\
              <div class="modal-footer">\
                <button type="button" class="btn btn-default" data-dismiss="modal">Close</button>\
              </div>\
            </div>\
          </div>\
        </div>';
})();