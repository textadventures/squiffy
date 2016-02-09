var gulp = require('gulp');
var gnf = require('gulp-npm-files');
var del = require('del');

gulp.task('clean', function() {
  return del(['dist']);
});

gulp.task('modules', ['clean'], function () {
  gulp.src(gnf(), {base:'./'}).pipe(gulp.dest('./dist'));
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
      'package.json',
      'squiffy.png',
    ])
    .pipe(gulp.dest('dist'));
});