/* jshint esversion: 6 */

var gulp = require('gulp');
var del = require('del');
var install = require('gulp-install');
var packager = require('electron-packager');
var rename = require('gulp-rename');
var shell = require('gulp-shell');
var jshint = require('gulp-jshint');

var electronVersion = '0.36.2';
var squiffyVersion = '5.1.0';

gulp.task('lint', function() {
  return gulp.src('./*.js')
    .pipe(jshint())
    .pipe(jshint.reporter('jshint-stylish'))
    .pipe(jshint.reporter('fail'));
});

gulp.task('clean', ['lint'], function() {
  return del(['dist']);
});

gulp.task('clean-osx', function() {
  return del(['Squiffy-darwin-x64', 'Squiffy.dmg']);
});

gulp.task('clean-linux', function() {
  return del(['Squiffy-linux-x64']);
});

gulp.task('clean-windows', function() {
  return del(['Squiffy-win32-ia32', 'Output']);
});

gulp.task('package.json', ['clean'], function () {
  return gulp.src('package.json')
    .pipe(gulp.dest('dist'));
});

gulp.task('modules', ['clean', 'package.json'], function () {
  return gulp.src(['dist/package.json'])
    .pipe(install({production: true}));
});

gulp.task('bootstrap', ['clean'], function () {
  return gulp.src('bower_components/bootstrap/dist/**/*')
    .pipe(gulp.dest('dist/bower_components/bootstrap/dist'));
});

gulp.task('jquery', ['clean'], function () {
  return gulp.src('node_modules/jquery/dist/*')
    .pipe(gulp.dest('node_modules/jquery/dist'));
});

gulp.task('ace', ['clean'], function () {
  return gulp.src('bower_components/ace-builds/src-min/**/*')
    .pipe(gulp.dest('dist/bower_components/ace-builds/src-min'));
});

gulp.task('jquery-ui', ['clean'], function () {
  return gulp.src('bower_components/jquery-ui/jquery-ui.min.js')
    .pipe(gulp.dest('dist/bower_components/jquery-ui'));
});

gulp.task('jquery-ui-layout', ['clean'], function () {
  return gulp.src('bower_components/jquery-ui-layout-bower/source/stable/jquery.layout.min.js')
    .pipe(gulp.dest('dist/bower_components/jquery-ui-layout-bower/source/stable'));
});

gulp.task('bootbox', ['clean'], function () {
  return gulp.src('bower_components/bootbox/bootbox.js')
    .pipe(gulp.dest('dist/bower_components/bootbox'));
});

gulp.task('chosen', ['clean'], function () {
  return gulp.src('bower_components/chosen/**/*')
    .pipe(gulp.dest('dist/bower_components/chosen'));
});

gulp.task('build-common', ['modules', 'bootstrap', 'jquery', 'ace', 'jquery-ui', 'jquery-ui-layout', 'bootbox', 'chosen'], function () {
  return gulp.src([
      'desktop.*',
      'editor.css',
      'example.squiffy',
      'desktop.html',
      '*.js',
      'squiffy.png',
    ])
    .pipe(gulp.dest('dist'));
});

/*
electron-packager supports this option:
  --sign="Developer ID Application: Luis Felipe Morales (2PZ4BV3S43)"
but we're hacking in a custom Info.plist so we sign afterwards
*/

gulp.task('osx', ['build-common', 'clean-osx'], function (callback) {
  var options = {
    dir: './dist',
    name: 'Squiffy',
    platform: 'darwin',
    arch: 'x64',
    version: electronVersion,
    'app-bundle-id': 'uk.co.textadventures.squiffy',
    'helper-bundle-id': 'uk.co.textadventures.squiffy.helper',
    icon: 'squiffy.icns',
    'app-version': squiffyVersion
  };
  
  packager(options, function (err, appPath) {
    if (err) return console.log(err);
    callback();
  });
});


gulp.task('linux', ['build-common', 'clean-linux'], function (callback) {
  var options = {
    dir: './dist',
    name: 'Squiffy',
    platform: 'linux',
    arch: 'x64',
    version: electronVersion,
    'app-bundle-id': 'uk.co.textadventures.squiffy',
    'helper-bundle-id': 'uk.co.textadventures.squiffy.helper',
    'app-version': squiffyVersion
  };
  
  packager(options, function (err, appPath) {
    if (err) return console.log(err);
    callback();
  });
});

gulp.task('windows', ['build-common', 'clean-windows'], function (callback) {
  var options = {
    dir: './dist',
    name: 'Squiffy',
    platform: 'win32',
    arch: 'ia32',
    version: electronVersion,
    'app-bundle-id': 'uk.co.textadventures.squiffy',
    'helper-bundle-id': 'uk.co.textadventures.squiffy.helper',
    icon: 'squiffy.ico',
    'app-version': squiffyVersion,
    ignore: 'Output',
    'version-string': {
      'ProductName': 'Squiffy',
      'FileDescription': 'Squiffy',
      'LegalCopyright': 'Copyright (c) 2017 Luis Felipe Morales',
      'OriginalFilename': 'Squiffy.exe',
      'FileVersion': squiffyVersion,
      'ProductVersion': squiffyVersion,
      'InternalName': 'Squiffy',
      'CompanyName': 'Luis Felipe Morales'
    }
  };
  
  packager(options, function (err, appPath) {
    if (err) return console.log(err);
    callback();
  });
});

gulp.task('osx-file-assoc', ['osx'], function () {
  var plist = require('plist');
  var fs = require('fs');
  var obj = plist.parse(fs.readFileSync('Squiffy-darwin-x64/Squiffy.app/Contents/Info.plist', 'utf8'));
  
  obj.CFBundleDocumentTypes = [{
    'CFBundleTypeExtensions':['squiffy'],
    'CFBundleTypeIconFile':'atom',
    'CFBundleTypeName':'Squiffy project',
    'CFBundleTypeRole':'Editor',
    'CFBundleTypeOSTypes':[
      'TEXT','utxt','TUTX','****'
    ]}];
  
  fs.writeFileSync('Squiffy-darwin-x64/Squiffy.app/Contents/Info.plist',
    plist.build(obj),
    'utf8');
});

gulp.task('osx-verify-file-assoc', ['osx-file-assoc'], shell.task([
  '/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister -lint -f Squiffy-darwin-x64/Squiffy.app'
]));

gulp.task('osx-sign-clean', ['osx-verify-file-assoc'], function () {
  return del([
    'Squiffy-darwin-x64/Squiffy.app/Contents/Frameworks/Squiffy Helper.app/Contents/MacOS/Squiffy Helper.cstemp',
    'Squiffy-darwin-x64/Squiffy.app/Contents/Frameworks/Squiffy Helper EH.app/Contents/MacOS/Squiffy Helper EH.cstemp',
    'Squiffy-darwin-x64/Squiffy.app/Contents/Frameworks/Squiffy Helper NP.app/Contents/MacOS/Squiffy Helper NP.cstemp'
  ]);
});

gulp.task('osx-sign', ['osx-sign-clean'], shell.task([
  'codesign -s "Developer ID Application: Luis Felipe Morales (2PZ4BV3S43)" Squiffy-darwin-x64/Squiffy.app/Contents/Frameworks/Squiffy\\ Helper.app',
  'codesign -s "Developer ID Application: Luis Felipe Morales (2PZ4BV3S43)" Squiffy-darwin-x64/Squiffy.app/Contents/Frameworks/Squiffy\\ Helper\\ EH.app/Contents/MacOS/Squiffy\\ Helper\\ EH',
  'codesign -s "Developer ID Application: Luis Felipe Morales (2PZ4BV3S43)" Squiffy-darwin-x64/Squiffy.app/Contents/Frameworks/Squiffy\\ Helper\\ EH.app',
  'codesign -s "Developer ID Application: Luis Felipe Morales (2PZ4BV3S43)" Squiffy-darwin-x64/Squiffy.app/Contents/Frameworks/Squiffy\\ Helper\\ NP.app/Contents/MacOS/Squiffy\\ Helper\\ NP',
  'codesign -s "Developer ID Application: Luis Felipe Morales (2PZ4BV3S43)" Squiffy-darwin-x64/Squiffy.app/Contents/Frameworks/Squiffy\\ Helper\\ NP.app',
  'codesign -s "Developer ID Application: Luis Felipe Morales (2PZ4BV3S43)" Squiffy-darwin-x64/Squiffy.app/Contents/Frameworks/Electron\\ Framework.framework/Versions/Current/Electron\\ Framework',
  'codesign -s "Developer ID Application: Luis Felipe Morales (2PZ4BV3S43)" Squiffy-darwin-x64/Squiffy.app/Contents/Frameworks/Mantle.framework',
  'codesign -s "Developer ID Application: Luis Felipe Morales (2PZ4BV3S43)" Squiffy-darwin-x64/Squiffy.app/Contents/Frameworks/ReactiveCocoa.framework',
  'codesign -s "Developer ID Application: Luis Felipe Morales (2PZ4BV3S43)" Squiffy-darwin-x64/Squiffy.app/Contents/Frameworks/Squirrel.framework',
  'codesign -s "Developer ID Application: Luis Felipe Morales (2PZ4BV3S43)" Squiffy-darwin-x64/Squiffy.app',
  'spctl --verbose=4 --assess --type execute Squiffy-darwin-x64/Squiffy.app'
]));

gulp.task('osx-dmg', ['osx-sign'], function () {
  var appdmg = require('appdmg');
  appdmg({
    source: 'appdmg.json',
    target: `Squiffy.${squiffyVersion}.OSX.dmg`
  });
});
   
gulp.task('windows-setup', ['windows'], function () {
  var innosetup = require('innosetup-compiler');
    innosetup('setup.iss', {
      verbose: true
  });
});