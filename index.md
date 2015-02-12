---
layout: index
title: Squiffy - Documentation
---

Squiffy is a tool for creating interactive fiction.

The Squiffy compiler reads in a Squiffy script file, and outputs HTML, CSS and JavaScript. A player's game state is saved automatically to Local Storage.

Example
-------

<div class="row">
	<div class="col-md-6">
<pre>
{% include_relative samples/example.squiffy %}
</pre>
	</div>
	<div class="col-md-6">
		<div id="sample-output" style="max-height: 500px"></div>
		<hr/>
		<button id="sample-restart" class="btn btn-primary btn-sm">Restart</button>
	</div>
</div>

<script src="samples/story.js"></script>
<script>
	$(function(){
		$("#sample-output").squiffy({
			input: "#sample-input",
			restart: "#sample-restart",
			scroll: "element",
			persist: false,
			restartPrompt: false,
		});
	});
</script>

Documentation
-------------

- [Installing Squiffy](install.html)
- [Using Squiffy](usage.html)
- [Sections and Passages](sections-passages.html)
- [Using JavaScript](javascript.html)
- [Importing Files](import.html)
- [Turn Counting](turncount.html)
- [Clearing the screen](clear.html)
- [Attributes](attributes.html)
- [Customising HTML and CSS](customise.html)
- [Embedding text](embed.html)
- [Tracking which sections and passages have been seen](seen.html)
- [Setting the start section](start.html)
- [Setting the title](title.html)
- [Continue links](continue.html)
- [Replacing text](replace.html)
- [Rotate and Sequence](rotate-sequence.html)
- [Master sections and passages](master.html)

Publishing your game
--------------------

Squiffy creates HTML, CSS and JavaScript files, which you can upload anywhere. You don't need to distribute your source `.squiffy` file - everything that is needed for the game to run is contained in the HTML and JavaScript.

An easy way to distribute your game is to create a ZIP file and [submit it to textadventures.co.uk](http://textadventures.co.uk/create/submit).

Contributing
------------

[Development Roadmap](roadmap.html)

If you find a bug, please log it on the [Issue Tracker](https://github.com/textadventures/squiffy/issues).

You can also discuss Squiffy at [the forum](http://forum.textadventures.co.uk/viewforum.php?f=24).

Squiffy is completely open source, including this documentation! The source code and documentation both live [on GitHub](https://github.com/textadventures/squiffy) (documentation is in the `gh-pages` branch).