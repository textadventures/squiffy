// based on http://www.mylifeforthecode.com/saving-and-restoring-window-state-in-electron/

var app;

try {
  app = require('app'); 
}
catch (e) {
  var remote = require('remote');
  app = remote.require('app');
}
 
var fs = require('fs');
var path = require('path');
var data = null;
var dataFilePath = path.join(app.getPath('userData'), 'settings.json'); 

function load() {
  if (!fs.existsSync(dataFilePath)) {
    data = {};
    return;
  }

  data = JSON.parse(fs.readFileSync(dataFilePath, 'utf-8')); 
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