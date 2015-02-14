/* jshint quotmark: single */
/* jshint evil: true */

(function () {
    'use strict';

    $.fn.squiffyEditor = function (options) {
        var editorHtml = this;
        $.get('squiffy-editor.html', function (data) {
            editorHtml.html(data);
            
            var editor = ace.edit('editor');
            editor.setTheme('ace/theme/eclipse');
            editor.getSession().setMode('ace/mode/markdown');
            editor.getSession().setUseWrapMode(true);
            editor.focus();

            editor.setValue(options.data, -1);

            $('#run').click(function () {
                $('#output-container').html('');
                $.post('http://squiffy.textadventures.co.uk', editor.getValue(), function (data) {
                    $('<div/>', { id: 'output', style: 'max-height: 400px' })
                        .appendTo('#output-container');

                    $('<hr/>').appendTo('#output-container');
                    $('<button/>', { id: 'sample-restart', 'class': 'btn btn-primary btn-sm' })
                        .html('Restart')
                        .appendTo('#output-container');

                    if (data.indexOf('Failed') === 0) {
                        $('#output').html(data);
                        return;
                    }

                    eval(data);
                    $('#output').squiffy({
                        restart: '#sample-restart',
                        scroll: 'element',
                        persist: false,
                        restartPrompt: false
                    });
                });
            });
        });
    };
})();