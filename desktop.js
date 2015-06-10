$(function () {
  // TODO: Use this local compiler instead of web service
  var compiler = require('squiffy/compiler.js');

  var compile = function (input) {
    var url = 'http://squiffy.textadventures.co.uk';

    if (input.zip) {
      // Using XMLHttpRequest here as jQuery doesn't support blob downloads
      url += '/zip';
      var xhr = new XMLHttpRequest();
      xhr.open('POST', url, true);
      xhr.responseType = 'blob';
       
      xhr.onload = function(e) {
        if (this.status == 200) {
          input.success(this.response);
        }
        else {
          input.fail(this.response);
        }
      };
       
      xhr.send(input.data);
      return;
    }

    $.post(url, input.data, function (data) {
      if (data.indexOf('Failed') === 0) {
          input.fail(data);
          return;
      }
      input.success(data);
    });
  };

  $('#inputfile').on('change', function () {
      var objectUrl = window.URL.createObjectURL(this.files[0]);
      if (!objectUrl) return;
      $.get(objectUrl, function (data) {
          $('#squiffy-editor').squiffyEditor('load', data);
      });
  });

  var init = function (data) {
    $('#squiffy-editor').squiffyEditor({
      data: data,
      compile: compile,
      open: function () {
        $('#inputfile').click();
      },
      save: function (title) {
        bootbox.alert('Save not implemented in demo');
        $('#squiffy-editor').squiffyEditor('setInfo', 'Not saved');
      },
      autoSave: function (title) {
        console.log('Auto save');
      },
      preview: function () {
        bootbox.alert('Preview not implemented in demo');
      },
      publish: function () {
        bootbox.alert('Publish not implemented in demo');
      },
      storageKey: 'squiffy',
      updateTitle: function (title) {
        document.title = title;
      },
    });
  };

  var saved = localStorage['squiffy'];
  if (saved) {
    init(localStorage['squiffy']);
  }
  else {
    $.get('example.squiffy', init);
  }
});