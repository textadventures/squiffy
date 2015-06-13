$(function () {
  var compiler = require('squiffy/compiler.js');
  var shell = require('shell');
  var path = require('path');
  var remote = require('remote');
  var dialog = remote.require('dialog');
  var fs = require('fs');

  window.menuClick = window.menuClick || {};

  var filename = null;

  var compile = function (input) {
    if (input.zip) {
      // TODO: Generate zip files using local compiler.js

      var url = 'http://squiffy.textadventures.co.uk/zip';
      // Using XMLHttpRequest here as jQuery doesn't support blob downloads
      var xhr = new XMLHttpRequest();
      xhr.open('POST', url, true);
      xhr.responseType = 'blob';
       
      xhr.onload = function(e) {
        if (this.status == 200) {
          input.success(this.response);
        }
        else {
          input.fail(this.response);
        }
      };
       
      xhr.send(input.data);
      return;
    }

    var js = compiler.getJs(input.data);
    if (js.indexOf('Failed') === 0) {
        input.fail(js);
        return;
    }
    input.success(js);
  };

  var updateTitle = function () {
    if (!filename) {
      document.title = 'New file';
    }
    else{
      document.title = path.basename(filename);
    }
  };

  window.menuClick.openFile = function () {
    var result = dialog.showOpenDialog({
      filters: [
        { name: 'Squiffy scripts', extensions: ['squiffy'] }
      ]
    });
    if (!result) return;
    filename = result[0];
    var data = fs.readFileSync(filename).toString();
    updateTitle();
    $('#squiffy-editor').squiffyEditor('load', data);
  };

  var init = function (data) {
    $('#squiffy-editor').squiffyEditor({
      data: data,
      compile: compile,
      open: function () {
        window.menuClick.openFile();
      },
      save: function (title) {
        bootbox.alert('Save not implemented in demo');
        $('#squiffy-editor').squiffyEditor('setInfo', 'Not saved');
      },
      autoSave: function (title) {
        console.log('Auto save');
      },
      preview: function () {
        bootbox.alert('Preview not implemented in demo');
      },
      publish: function () {
        bootbox.alert('Publish not implemented in demo');
      },
      storageKey: 'squiffy',
      updateTitle: function () {},
    });
  };

  var saved = localStorage['squiffy'];
  if (saved) {
    init(localStorage['squiffy']);
  }
  else {
    $.get('example.squiffy', init);
  }

  $('#squiffy-editor').on('click', 'a.external-link, #output-container a[href]', function (e) {
    shell.openExternal($(this).attr('href'));
    e.preventDefault();
  });
});