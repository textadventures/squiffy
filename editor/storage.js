// Squiffy-editor MIT License
// based on
// http://www.mylifeforthecode.com/saving-and-restoring-window-state-in-electron/

var app;

try {
  app = require('electron').remote.app;
} catch (e) {
  app = require('electron').app;
}

const {dialog} = require('electron');
const fs = require('fs');
const path = require('path');
const dataFilePath = path.join(app.getPath('userData'), 'settings.json');
var data = null;

function load() {
  if (!fs.existsSync(dataFilePath)) {
    data = {};
    save();
    return;
  }

  try {
      data = JSON.parse(fs.readFileSync(dataFilePath, 'utf-8'));
  } catch(exc) {
      const msg = 'Error loading settings. Back to defaults.';
      data = {};
      save();

      console.log(msg + "\n\t" + exc);
      dialog.showMessageBox({
          message: msg,
          buttons: ["OK"] });
  }
}

function save() {
  fs.writeFileSync(dataFilePath, JSON.stringify(data));
}

exports.set = function (key, value) {
  load();
  data[key] = value;
  save();
};

exports.get = function (key) {
  load();
  var value = null;
  if (key in data) {
    value = data[key];
  }
  return value;
};

exports.unset = function (key) {
  load();
  if (key in data) {
    delete data[key];
    save();
  }
};
