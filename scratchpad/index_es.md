---
layout: index_es
title: Squiffy ScratchPad
---

<div class="row" style="margin-bottom: 10px">
    <button id="run" class="btn btn-success">Run</button>
    <button class="btn btn-primary" data-toggle="modal" data-target="#loadgist">Load Gist</button>
</div>

<div class="row">
    <div class="col-md-6" style="height: 500px">
        <div id="editor" class="editor"></div>
    </div>
    <div class="col-md-6">
        <div id="output-container"></div>
    </div>
</div>

<div class="modal fade" id="loadgist">
  <div class="modal-dialog">
    <div class="modal-content">
      <div class="modal-header">
        <button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button>
        <h4 class="modal-title">Load GitHub Gist</h4>
      </div>
      <div class="modal-body">
        <p>You can load a <a href="https://gist.github.com/" target="_blank">GitHub Gist</a> here.</p>
        <p>For example, <a href="https://gist.github.com/alexwarren/671962a08b9a6e56da29" target="_blank">https://gist.github.com/alexwarren/671962a08b9a6e56da29</a> has a Gist ID of <code>671962a08b9a6e56da29</code> and a filename of <code>sample.squiffy</code>.</p>
        <form>
          <div class="form-group">
            <label for="gistid">Gist ID</label>
            <input type="text" class="form-control" id="gistid">
          </div>
          <div class="form-group">
            <label for="filename">Filename</label>
            <input type="text" class="form-control" id="filename">
          </div>
        </form>

      </div>
      <div class="modal-footer">
        <button id="load" type="button" class="btn btn-primary" disabled="disabled">Load</button>
        <button type="button" class="btn btn-default" data-dismiss="modal">Cancel</button>
      </div>
    </div>
  </div>
</div>

<script>
    var $_GET = {};
    document.location.search.replace(/\??(?:([^=]+)=([^&]*)&?)/g, function () {
        function decode(s) {
            return decodeURIComponent(s.split("+").join(" "));
        }
        $_GET[decode(arguments[1])] = decode(arguments[2]);
    });

    var editor = ace.edit("editor");
    editor.setTheme("ace/theme/eclipse");
    editor.getSession().setMode("ace/mode/markdown");
    editor.getSession().setUseWrapMode(true);
    editor.focus();

    if ($_GET["gistid"] && $_GET["filename"]) {
        var gistid = $_GET["gistid"];
        var filename = $_GET["filename"];
        $("#gistid").val(gistid);
        $("#filename").val(filename);
        $.ajax({
            url: "https://api.github.com/gists/" + gistid,
            type: "GET",
            dataType: "jsonp"
        }).success(function (gistdata) {
            var content = gistdata.data.files[filename].content;
            editor.setValue(content, -1);
        });
    }
    else {
        var url = $_GET["src"] || "{{site.baseurl}}/samples/example.squiffy";
        $.get(url, function (data) {
            editor.setValue(data, -1);
        });
    } 

    $("#run").click(function () {
        $("#output-container").html("");
        $("<div/>", { id: "output", style: "max-height: 400px" })
            .appendTo("#output-container");

        $.ajax({
            url: "http://squiffy.textadventures.co.uk",
            data: editor.getValue(),
            type: "POST",
            success: function (data) {
                $("<hr/>").appendTo("#output-container");
                $("<button/>", { id: "sample-restart", "class": "btn btn-primary btn-sm" })
                    .html("Restart")
                    .appendTo("#output-container");

                eval(data);
                $("#output").squiffy({
                    scroll: "element",
                    persist: false,
                    restartPrompt: false
                });

                $("#sample-restart").click(function () {
                    $("#output").squiffy("restart");
                });
            },
            error: function (xhr) {
                $("#output").html(xhr.responseText);
                return;
            }
        });
    });

    var setLoadEnabled = function () {
        if ($("#gistid").val() && $("#filename").val()) {
            $("#load").removeAttr("disabled");
        }
        else {
            $("#load").attr("disabled", "disabled");
        }
    };

    $("#gistid").on("input", function () {
        setLoadEnabled();
    });

    $("#filename").on("input", function () {
        setLoadEnabled();
    });

    $("#load").click(function () {
        window.location = "{{site.baseurl}}/scratchpad/?gistid=" + $("#gistid").val() + "&filename=" + $("#filename").val();
    });
</script>