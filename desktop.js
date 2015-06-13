$(function () {
  var compiler = require('squiffy/compiler.js');
  var shell = require('shell');
  var path = require('path');
  var remote = require('remote');
  var dialog = remote.require('dialog');
  var fs = require('fs');

  window.menuClick = window.menuClick || {};

  var filename = null;
  var dirty = false;

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
    else {
      document.title = path.basename(filename);
      remote.getCurrentWindow().setRepresentedFilename(filename);
    }
    if (process.platform != 'darwin') {
      document.title = document.title + ' - Squiffy';
    }
  };

  var setDirty = function (isDirty) {
    remote.getCurrentWindow().setDocumentEdited(isDirty);
    dirty = isDirty;
  };

  var checkForUnsavedChanges = function () {
    if (!dirty) return true;

    var result = dialog.showMessageBox({
      type: 'warning',
      buttons: ['Yes', 'No', 'Cancel'],
      message: 'Do you wish to save your changes to ' + (filename ? path.basename(filename) : 'this file') + '?'
    });

    if (result === 0) {
      window.menuClick.saveFile();
      return !dirty;
    }

    return (result !== 2);
  };

  window.onbeforeunload = function (e) {
    return checkForUnsavedChanges();
  }

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
    setDirty(false);
  }

  window.menuClick.newFile = function () {
    if (!checkForUnsavedChanges()) return;
    $('#squiffy-editor').squiffyEditor('load', '');
    setFilename(null);
    setDirty(false);
  };

  window.menuClick.openFile = function () {
    if (!checkForUnsavedChanges()) return;
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
    setDirty(false);
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
      setDirty: function () {
        setDirty(true);
      }
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