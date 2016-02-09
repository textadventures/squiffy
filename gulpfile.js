var gulp = require('gulp');
var gnf = require('gulp-npm-files');  

gulp.task('modules', function() {
  gulp.src(gnf(), {base:'./'}).pipe(gulp.dest('./dist'));
});

gulp.task('default', ['modules'], function() {
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