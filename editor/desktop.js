/* global __dirname */
/* global $ */
/* global process */

$(function () {
  const compiler = require('squiffy/compiler.js');
  const remote = require('electron').remote;
  const shell = remote.shell;
  const path = require('path');
  const dialog = remote.dialog;
  const fs = require('fs');
  const clipboard = remote.clipboard;
  const storage = require('./storage.js');

  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json')).toString());
  const editorVersion = packageJson.version;

  window.menuClick = window.menuClick || {};

  var filename = null;
  var dirty = false;

  const compile = function (input) {
    var msgs = "";

    console._log = console.log;
    console.log = function(msg) {
        msgs += "<p>" + msg + "</p>";
        console._log(msg);
    };

    const js = compiler.getJs(input.data);
    console.log = console._log;

    if (js.indexOf('Failed') === 0) {
        input.fail(js, msgs);
        return;
    }
    input.success(js, msgs);
  };

  const build = function () {
    window.menuClick.saveFile();
    if (dirty) return;

    var options = {
      write: true,
	  escritorio: true,
    };

    var result = compiler.generate(filename, options);

    if (result) {
      shell.openItem(path.join(result, 'index.html'));
    }
    else {
      dialog.showMessageBox({
        type: 'warning',
        message: 'Failed to build script',
        buttons: ['OK']
      });
    }
  };

  const setFilename = function (newFilename, noStore) {
    filename = newFilename;
    if (!noStore) localStorage['squiffy-filename'] = filename;
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

  const setDirty = function (isDirty) {
    remote.getCurrentWindow().setDocumentEdited(isDirty);
    dirty = isDirty;
  };

  const checkForUnsavedChanges = function () {
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
  };

  setFilename(null, true);

  const loadFileData = function (file) {
    var data;
    try {
      data = fs.readFileSync(file).toString();
    }
    catch (e) {
      return null;
    }
    setFilename(file);
    return data;
  };

  const saveFile = function () {
    fs.writeFileSync(filename, $('#squiffy-editor').squiffyEditor('save'));
    $('#squiffy-editor').squiffyEditor('setInfo', 'Saved');
    setDirty(false);
  };

  window.menuClick.newFile = function () {
    if (!checkForUnsavedChanges()) return;
    $('#squiffy-editor').squiffyEditor('load', '');
    setFilename(null);
    setDirty(false);
  };

  window.menuClick.openFile = function () {
    if (!checkForUnsavedChanges()) return;
      const result = dialog.showOpenDialog({
      filters: [
        { name: 'Squiffy scripts', extensions: ['sq', 'squiffy'] }
      ]
    });
    if (!result) return;
    window.loadFile(result[0]);
  };

  window.loadFile = function (file) {
    if (!checkForUnsavedChanges()) return;
    const data = loadFileData(file);
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
    const result = dialog.showSaveDialog({
      filters: [
        { name: 'Squiffy scripts', extensions: ['sq', 'squiffy'] }
      ]
    });
    if (!result) return;
    setFilename(result);
    saveFile();
  };

  window.menuClick.undo = function () {
    $('#squiffy-editor').squiffyEditor('undo');
  };

  window.menuClick.redo = function () {
    $('#squiffy-editor').squiffyEditor('redo');
  };

  window.menuClick.cut = function () {
    clipboard.writeText($('#squiffy-editor').squiffyEditor('cut'));
  };

  window.menuClick.copy = function () {
    clipboard.writeText($('#squiffy-editor').squiffyEditor('copy'));
  };

  window.menuClick.paste = function () {
    $('#squiffy-editor').squiffyEditor('paste', clipboard.readText());
  };

  window.menuClick.selectAll = function () {
    $('#squiffy-editor').squiffyEditor('selectAll');
  };

  window.menuClick.run = function () {
    $('#squiffy-editor').squiffyEditor('run');
  };

  window.menuClick.find = function () {
    $('#squiffy-editor').squiffyEditor('find');
  };

  window.menuClick.replace = function () {
    $('#squiffy-editor').squiffyEditor('replace');
  };

  window.menuClick.build = function () {
    build();
  };

  window.menuClick.openFolder = function () {
    shell.showItemInFolder(filename);
  };

  window.menuClick.documentation = function() {
    shell.openExternal('http://docs.textadventures.co.uk/squiffy/');
  };

  window.menuClick.about = function () {
    $('#about-build').text(editorVersion);
    var versions = [];
    for (var key in process.versions) {
      versions.push(key + ' ' + process.versions[key]);
    }
    $('#about-versions').text(versions.join(', '));
    $('#about').modal();
  };

  window.menuClick.settings = function () {
    $('#settings-dialog').modal();
  };

  var userSettings = {
    get: function (setting) {
      return storage.get(setting);
    },
    set: function (setting, value) {
      storage.set(setting, value);
    }
  };

  var init = function (data) {
    $('#squiffy-editor').squiffyEditor({
      data: data,
      desktop: true,
      compile: compile,
      open: window.menuClick.openFile,
      save: window.menuClick.saveFile,
      autoSave: function () {},
      updateTitle: function () {},
      setDirty: function () {
        setDirty(true);
      },
      build: function () {
        build();
      },
      userSettings: userSettings
    });
  };

  var openFile = remote.getCurrentWindow().openFile;

  if (!openFile) {
    openFile = localStorage['squiffy-filename'];
  }

  if (openFile) {
    var data = loadFileData(openFile);
    if (data) {
      init(data);
    }
    else {
      openFile = null;
    }
  }

  if (!openFile) {
    $.get('example.squiffy', init);
  }

  $('#squiffy-editor').on('click', 'a.external-link, #output-container a[href]', function (e) {
    shell.openExternal($(this).attr('href'));
    e.preventDefault();
  });

  $('#update-check').click(function () {
    $('#about-update').text('Checking for updates...');
    $.get('http://textadventures.co.uk/squiffy/versioncheck/?version=' + editorVersion, function (result) {
      if (result.Latest <= editorVersion) {
        $('#about-update').text('You are running the latest version of Squiffy.');
      }
      else {
        $('#about-update').html('<b><a id="update-link" href="#">New version! Update to ' + result.Name + '</a></b>');
        $('#update-link').click(function () {
          shell.openExternal(result.Url);
        });
      }
    });
  });

  document.addEventListener('dragover', function (event) {
    event.preventDefault();
    return false;
  }, false);

  document.addEventListener('drop', function (event) {
    event.preventDefault();
    return false;
  }, false);
});
