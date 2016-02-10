var gulp = require('gulp');
var del = require('del');
var install = require('gulp-install');
var packager = require('electron-packager');
var rename = require('gulp-rename');
var shell = require('gulp-shell');

gulp.task('clean', function() {
  return del(['dist']);
});

gulp.task('clean-osx', function() {
  return del(['Squiffy-darwin-x64']);
});

gulp.task('clean-linux', function() {
  return del(['Squiffy-linux-x64']);
});

gulp.task('clean-windows', function() {
  return del(['Squiffy-win32-ia32', 'Output']);
});

gulp.task('package.json', ['clean'], function () {
  return gulp.src('package.json')
    .pipe(gulp.dest('dist'))
});

gulp.task('modules', ['clean', 'package.json'], function () {
  return gulp.src(['dist/package.json'])
    .pipe(install({production: true}));
});

gulp.task('bootstrap', ['clean'], function () {
  return gulp.src('bower_components/bootstrap/dist/**/*')
    .pipe(gulp.dest('dist/bower_components/bootstrap/dist'))
});

gulp.task('jquery', ['clean'], function () {
  return gulp.src('bower_components/jquery/dist/**/*')
    .pipe(gulp.dest('dist/bower_components/jquery/dist'))
});

gulp.task('ace', ['clean'], function () {
  return gulp.src('bower_components/ace-builds/src-min/**/*')
    .pipe(gulp.dest('dist/bower_components/ace-builds/src-min'))
});

gulp.task('jquery-ui', ['clean'], function () {
  return gulp.src('bower_components/jquery-ui/jquery-ui.min.js')
    .pipe(gulp.dest('dist/bower_components/jquery-ui'))
});

gulp.task('jquery-ui-layout', ['clean'], function () {
  return gulp.src('bower_components/jquery-ui-layout-bower/source/stable/jquery.layout.min.js')
    .pipe(gulp.dest('dist/bower_components/jquery-ui-layout-bower/source/stable'))
});

gulp.task('bootbox', ['clean'], function () {
  return gulp.src('bower_components/bootbox/bootbox.js')
    .pipe(gulp.dest('dist/bower_components/bootbox'))
});

gulp.task('chosen', ['clean'], function () {
  return gulp.src('bower_components/chosen/**/*')
    .pipe(gulp.dest('dist/bower_components/chosen'))
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
  --sign="Developer ID Application: Alex Warren (6RPC48SJ57)"
but we're hacking in a custom Info.plist so we sign afterwards
*/

gulp.task('osx', ['build-common', 'clean-osx'], function (callback) {
  var options = {
    dir: './dist',
    name: 'Squiffy',
    platform: 'darwin',
    arch: 'x64',
    version: '0.36.2',
    'app-bundle-id': 'uk.co.textadventures.squiffy',
    'helper-bundle-id': 'uk.co.textadventures.squiffy.helper',
    icon: 'squiffy.icns',
    'app-version': '5.0.0'
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
    version: '0.36.2',
    'app-bundle-id': 'uk.co.textadventures.squiffy',
    'helper-bundle-id': 'uk.co.textadventures.squiffy.helper',
    'app-version': '5.0.0'
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
    version: '0.36.2',
    'app-bundle-id': 'uk.co.textadventures.squiffy',
    'helper-bundle-id': 'uk.co.textadventures.squiffy.helper',
    icon: 'squiffy.ico',
    'app-version': '5.0.0',
    ignore: 'Output',
    'version-string': {
      'ProductName': 'Squiffy',
      'FileDescription': 'Squiffy',
      'LegalCopyright': 'Copyright (c) 2016 Alex Warren',
      'OriginalFilename': 'Squiffy.exe',
      'FileVersion': '5.0.0',
      'ProductVersion': '5.0.0',
      'InternalName': 'Squiffy',
      'CompanyName': 'Alex Warren'
    }
  };
  
  packager(options, function (err, appPath) {
    if (err) return console.log(err);
    callback();
  });
});

gulp.task('osx-file-assoc', ['osx'], function () {
  del(['Squiffy-darwin-x64/Squiffy.app/Contents/Info.plist']);
  
  return gulp.src('file association - Info.plist')
    .pipe(rename('Info.plist'))
    .pipe(gulp.dest('Squiffy-darwin-x64/Squiffy.app/Contents', {overwrite: true}));
});

gulp.task('osx-verify-file-assoc', ['osx-file-assoc'], shell.task([
  '/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister -lint -f Squiffy-darwin-x64/Squiffy.app'
]));

gulp.task('windows-setup', ['windows'], function () {
  var innosetup = require('innosetup-compiler');
  innosetup('setup.iss', {
    verbose: true
  });
});