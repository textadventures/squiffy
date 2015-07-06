(function () {
  var remote = require('remote');
  var app = remote.require('app');
  window.menuClick = window.menuClick || {};
  
  var fileNew = function () {
    window.menuClick.newFile();
  };

  var fileOpen = function () {
    window.menuClick.openFile();
  };

  var fileSave = function () {
    window.menuClick.saveFile();
  };

  var fileSaveAs = function () {
    window.menuClick.saveFileAs();
  };

  var editUndo = function () {
    window.menuClick.undo();
  };

  var editRedo = function () {
    window.menuClick.redo();
  };

  var editCut = function () {
    window.menuClick.cut();
  };

  var editCopy = function () {
    window.menuClick.copy();
  };

  var editPaste = function () {
    window.menuClick.paste();
  };

  var editSelectAll = function () {
    window.menuClick.selectAll();
  };

  var documentation = function () {
    window.menuClick.documentation();
  };

  var buildRun = function () {
    window.menuClick.run();
  };

  var buildBuild = function () {
    window.menuClick.build();
  };

  var buildOpenFolder = function () {
    window.menuClick.openFolder();
  };

  var about = function () {
    window.menuClick.about();
  };

  var template;

  if (process.platform === 'darwin') {
    template = [
      {
        label: 'Squiffy',
        submenu: [
          {
            label: 'About Squiffy',
            click: about
          },
          {
            type: 'separator'
          },
          {
            label: 'Services',
            submenu: []
          },
          {
            type: 'separator'
          },
          {
            label: 'Hide Squiffy',
            accelerator: 'Command+H',
            selector: 'hide:'
          },
          {
            label: 'Hide Others',
            accelerator: 'Command+Shift+H',
            selector: 'hideOtherApplications:'
          },
          {
            label: 'Show All',
            selector: 'unhideAllApplications:'
          },
          {
            type: 'separator'
          },
          {
            label: 'Quit',
            accelerator: 'Command+Q',
            selector: 'terminate:'
          },
        ]
      },
      {
        label: 'File',
        submenu: [
          {
            label: 'New',
            accelerator: 'Command+N',
            click: fileNew
          },
          {
            label: 'Open...',
            accelerator: 'Command+O',
            click: fileOpen
          },
          {
            label: 'Save',
            accelerator: 'Command+S',
            click: fileSave
          },
          {
            label: 'Save As...',
            accelerator: 'Command+Shift+S',
            click: fileSaveAs
          },
        ]
      },
      {
        label: 'Edit',
        submenu: [
          {
            label: 'Undo',
            accelerator: 'Command+Z',
            click: editUndo
          },
          {
            label: 'Redo',
            accelerator: 'Command+Y',
            click: editRedo
          },
          {
            type: 'separator'
          },
          {
            label: 'Cut',
            accelerator: 'Command+X',
            click: editCut
          },
          {
            label: 'Copy',
            accelerator: 'Command+C',
            click: editCopy
          },
          {
            label: 'Paste',
            accelerator: 'Command+V',
            click: editPaste
          },
          {
            label: 'Select All',
            accelerator: 'Command+A',
            click: editSelectAll
          },
        ]
      },
      {
        label: 'View',
        submenu: [
          {
            label: 'Reload',
            accelerator: 'Alt+Command+R',
            click: function() { remote.getCurrentWindow().reloadIgnoringCache(); }
          },
          {
            label: 'Toggle DevTools',
            accelerator: 'Alt+Command+I',
            click: function() { remote.getCurrentWindow().toggleDevTools(); }
          },
        ]
      },
      {
        label: 'Build',
        submenu: [
          {
            label: 'Run',
            accelerator: 'Command+R',
            click: buildRun
          },
          {
            label: 'Build',
            accelerator: 'Command+B',
            click: buildBuild
          },
          {
            label: 'Open Folder',
            click: buildOpenFolder
          }
        ]
      },
      {
        label: 'Window',
        submenu: [
          {
            label: 'Minimize',
            accelerator: 'Command+M',
            selector: 'performMiniaturize:'
          },
          {
            label: 'Close',
            accelerator: 'Command+W',
            selector: 'performClose:'
          },
          {
            type: 'separator'
          },
          {
            label: 'Bring All to Front',
            selector: 'arrangeInFront:'
          },
        ]
      },
      {
        label: 'Help',
        submenu: [
          {
            label: 'Documentation',
            click: documentation
          }
        ]
      },
    ];
  }
  else {
    template = [
      {
        label: '&File',
        submenu: [
          {
            label: '&New',
            accelerator: 'Ctrl+N',
            click: fileNew
          },
          {
            label: '&Open...',
            accelerator: 'Ctrl+O',
            click: fileOpen
          },
          {
            label: '&Save',
            accelerator: 'Ctrl+S',
            click: fileSave
          },
          {
            label: 'Save &As...',
            accelerator: 'Ctrl+Shift+S',
            click: fileSaveAs
          },
          {
            type: 'separator'
          },
          {
            label: 'E&xit',
            click: function() { app.quit(); }
          }
        ]
      },
      {
        label: '&Edit',
        submenu: [
          {
            label: '&Undo',
            accelerator: 'Ctrl+Z',
            click: editUndo
          },
          {
            label: '&Redo',
            accelerator: 'Ctrl+Y',
            click: editRedo
          },
          {
            type: 'separator'
          },
          {
            label: 'Cu&t',
            accelerator: 'Ctrl+X',
            click: editCut
          },
          {
            label: '&Copy',
            accelerator: 'Ctrl+C',
            click: editCopy
          },
          {
            label: '&Paste',
            accelerator: 'Ctrl+V',
            click: editPaste
          },
          {
            label: 'Select &All',
            accelerator: 'Ctrl+A',
            click: editSelectAll
          },
        ]
      },
      {
        label: '&View',
        submenu: [
          {
            label: '&Reload',
            accelerator: 'Ctrl+Shift+R',
            click: function() { remote.getCurrentWindow().reloadIgnoringCache(); }
          },
          {
            label: '&Toggle DevTools',
            accelerator: 'F12',
            click: function() { remote.getCurrentWindow().toggleDevTools(); }
          },
        ]
      },
      {
        label: '&Build',
        submenu: [
          {
            label: '&Run',
            accelerator: 'Ctrl+R',
            click: buildRun
          },
          {
            label: '&Build',
            accelerator: 'Ctrl+B',
            click: buildBuild
          },
          {
            label: '&Open Folder',
            click: buildOpenFolder
          }
        ]
      },
      {
        label: '&Help',
        submenu: [
          {
            label: '&Documentation',
            click: documentation
          },
          {
            type: 'separator'
          },
          {
            label: '&About Squiffy',
            click: about
          }
        ]
      },
    ];
  }

  var Menu = remote.require('menu');

  menu = Menu.buildFromTemplate(template);

  Menu.setApplicationMenu(menu);
})();