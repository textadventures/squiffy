/* global __dirname */
/* global process */

var electron = require('electron');
var app = electron.app;  // Module to control application life.
var BrowserWindow = electron.BrowserWindow;  // Module to create native browser window.
var storage = require('./storage');

// Report crashes to our server.
electron.crashReporter.start({
    companyName: "textadventure.co.uk",
    submitURL: "https://github.com/textadventures/squiffy-editor/issues",
});

var argv = process.argv;

var openFile;

if (process.platform !== 'darwin') {
  openFile = process.argv[1];
}

app.on('open-file', function (event, path) {
    event.preventDefault();
    openFile = path;
    if (mainWindow) {
      mainWindow.webContents.executeJavaScript('loadFile(' + JSON.stringify(path) + ')');
    }
});

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the javascript object is GCed.
var mainWindow = null;

var init = function() {
  var lastWindowState = storage.get('lastWindowState');
  if (lastWindowState === null) {
    lastWindowState = {
      width: 1200,
      height: 600,
      maximized: false 
    }; 
  }
  
  mainWindow = new BrowserWindow({
    x: lastWindowState.x,
    y: lastWindowState.y,
    width: lastWindowState.width, 
    height: lastWindowState.height,
    icon: __dirname + '/squiffy.png'
  });
  
  if (lastWindowState.maximized) {
    mainWindow.maximize();
  }

  mainWindow.openFile = openFile;

  // and load the index.html of the app.
  mainWindow.loadURL('file://' + __dirname + '/desktop.html');
  
  mainWindow.on('close', function() {
    var bounds = mainWindow.getBounds(); 
    storage.set('lastWindowState', {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      maximized: mainWindow.isMaximized()
    });
    mainWindow.destroy();
  });

  // Emitted when the window is closed.
  mainWindow.on('closed', function() {
    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    mainWindow = null;
  });
};

// Quit when all windows are closed, except on OS X.
app.on('window-all-closed', function() {
  if (process.platform != 'darwin') {
    app.quit();
  }
});

// On OS X, this is called when the app is running in the Dock with no open windows.
app.on('activate-with-no-open-windows', init);

// This method will be called when Electron has done everything
// initialization and ready for creating browser windows.
app.on('ready', init);
