$(function () {
  var compiler = require('squiffy/compiler.js');
  var shell = require('shell');
  var path = require('path');
  var remote = require('remote');
  var dialog = remote.require('dialog');
  var fs = require('fs');

  var packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json')).toString());
  var editorVersion = packageJson.version;

  window.menuClick = window.menuClick || {};

  var filename = null;
  var dirty = false;

  var compile = function (input) {
    var js = compiler.getJs(input.data);
    if (js.indexOf('Failed') === 0) {
        input.fail(js);
        return;
    }
    input.success(js);
  };

  var build = function () {
    window.menuClick.saveFile();
    if (dirty) return;
    
    var options = {
      write: true,
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

  var setFilename = function (newFilename, noStore) {
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

  var loadFileData = function (file) {
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
    window.loadFile(result[0]);
  };

  window.loadFile = function (file) {
    if (!checkForUnsavedChanges()) return;
    var data = loadFileData(file);
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

  window.menuClick.run = function () {
    $('#squiffy-editor').squiffyEditor('run');
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
    $('#about').modal();
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
      }
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
      if (result.Latest === editorVersion) {
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
});