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

  var setFilename = function (newFilename, noStore) {
    filename = newFilename;
    if (!noStore) localStorage['filename'] = filename;
    if (!filename) {
      document.title = 'New file';
    }
    else{
      document.title = path.basename(filename);
    }
  };

  setFilename(null, true);

  var loadFile = function (file) {
    var data;
    try {
      data = fs.readFileSync(file).toString();
    }
    catch (e) {
      return null;
    }
    setFilename(file);
    return data; 
  }

  var saveFile = function () {
    fs.writeFileSync(filename, $('#squiffy-editor').squiffyEditor('save'));
    $('#squiffy-editor').squiffyEditor('setInfo', 'Saved');
  }

  window.menuClick.openFile = function () {
    var result = dialog.showOpenDialog({
      filters: [
        { name: 'Squiffy scripts', extensions: ['squiffy'] }
      ]
    });
    if (!result) return;
    var data = loadFile(result[0]);
    if (data === null) {
      dialog.showMessageBox({
        type: 'warning',
        message: 'Failed to load file',
        buttons: ['OK']
      });
    }
    $('#squiffy-editor').squiffyEditor('load', data);
  };

  window.menuClick.saveFile = function () {
    if (!filename) {
      window.menuClick.saveFileAs();
      return;
    }
    saveFile();
  };

  window.menuClick.saveFileAs = function () {
    var result = dialog.showSaveDialog({
      filters: [
        { name: 'Squiffy scripts', extensions: ['squiffy'] }
      ]
    });
    if (!result) return;
    setFilename(result);
    saveFile();
  };

  var init = function (data) {
    $('#squiffy-editor').squiffyEditor({
      data: data,
      compile: compile,
      open: window.menuClick.openFile,
      save: window.menuClick.saveFile,
      autoSave: function () {},
      preview: function () {
        bootbox.alert('Preview not implemented in demo');
      },
      publish: function () {
        bootbox.alert('Publish not implemented in demo');
      },
      updateTitle: function () {},
    });
  };

  var previousFilename = localStorage['filename'];
  if (previousFilename) {
    var data = loadFile(previousFilename);
    if (data) {
      init(data);
    }
    else {
      previousFilename = null;
      localStorage['filename'] = null;
    }
  }
  
  if (!previousFilename) {
    $.get('example.squiffy', init);
  }

  $('#squiffy-editor').on('click', 'a.external-link, #output-container a[href]', function (e) {
    shell.openExternal($(this).attr('href'));
    e.preventDefault();
  });
});