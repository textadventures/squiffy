---
layout: index
title: Squiffy - Documentation
---

Squiffy is a tool for creating interactive fiction - that is, multiple choice games that focus on text and story. Players navigate through the game or story by clicking links. Sometimes these kinds of games or stories are known as [gamebooks](http://en.wikipedia.org/wiki/Gamebook).

Squiffy is free and open source. It creates HTML and JavaScript, so you can upload it to your own website, or you can upload your games for free to [textadventures.co.uk](http://textadventures.co.uk). You can also turn your game into an app using [PhoneGap](http://phonegap.com/).

A player's state is automatically saved to their browser's local storage, so they can always pick up from where they left off just by going back to the same web page.

Documentation
-------------

- [Sections and Passages](sections-passages.html)
- [Using JavaScript](javascript.html)
- [Turn Counting](turncount.html)
- [Clearing the screen](clear.html)
- [Attributes](attributes.html)
- [Embedding text](embed.html)
- [Tracking which sections and passages have been seen](seen.html)
- [Setting the start section](start.html)
- [Setting the title](title.html)
- [Continue links](continue.html)
- [Replacing text](replace.html)
- [Rotate and Sequence](rotate-sequence.html)
- [Master sections and passages](master.html)
- [Importing Files](import.html) (command-line version only)
- [Customising HTML and CSS](customise.html) (command-line version only)

Using Squiffy
-------------

- You can [use Squiffy in your web browser](http://textadventures.co.uk/squiffy/editor)
- Or you can [download Squiffy for Windows, OS X or Linux](https://github.com/textadventures/squiffy-editor/releases)
- Or you can use any text editor and compile games using the [command-line version](cli.html)

Example
-------

{% include sample.html file="example" %}

Publishing your game
--------------------

Squiffy creates HTML, CSS and JavaScript files, which you can upload anywhere. You don't need to distribute your source `.squiffy` file - everything that is needed for the game to run is contained in the HTML and JavaScript.

If you're using the web version, just hit the Publish button to share your game on textadventures.co.uk. You can also choose "Export HTML and JavaScript" from the Download menu, which will give you a ZIP file you can upload to any website.

If you're using the app for Windows, OS X or Linux, hit the Build button to create the HTML, CSS and JavaScript files in the same directory as the game file. This will also open the results in your web browser for you to preview. You can then put these into a ZIP file and [upload it to textadventures.co.uk](http://textadventures.co.uk/create/submit), or you could upload them to your own website.

Contributing
------------

[Development Roadmap](roadmap.html)

Squiffy lives in two different GitHub repositories:

- [textadventures/squiffy](https://github.com/textadventures/squiffy) - the Squiffy compiler
- [textadventures/squiffy-editor](https://github.com/textadventures/squiffy-editor) - the editor (both web and downloadable versions are from the same source)

If you find a bug, please log a [Squiffy compiler issue](https://github.com/textadventures/squiffy/issues) or a [Squiffy editor issue](https://github.com/textadventures/squiffy-editor/issues).

You can also discuss Squiffy at [the forum](http://forum.textadventures.co.uk/viewforum.php?f=24).

Squiffy is completely open source, including this documentation! The source code and documentation both live [on GitHub](https://github.com/textadventures/squiffy) (documentation is in the `gh-pages` branch).