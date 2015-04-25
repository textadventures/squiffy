---
layout: index
title: Squiffy - Documentation
---

Squiffy is a tool for creating interactive fiction - that is, multiple choice games that focus on text and story. Players navigate through the game or story by clicking links. Sometimes these kinds of games or stories are known as [gamebooks](http://en.wikipedia.org/wiki/Gamebook).

Squiffy's output is HTML and JavaScript, so you can:

- upload it to a website, or embed it within an existing page
- turn it into an app using [PhoneGap](http://phonegap.com/)

A player's state is automatically saved to their browser's local storage, so they can always pick up from where they left off just by going back to the same web page.

You can [use Squiffy in your web browser](http://textadventures.co.uk/squiffy/editor), or you can write games using a text editor with the [downloadable command-line version](install.html).

Example
-------

{% include sample.html file="example" %}

Installing Squiffy
------------------

The easiest way to use Squiffy is [in your web browser](http://textadventures.co.uk/squiffy/editor). As an alternative, you can use Squiffy from the command line:

- [Installing Squiffy](install.html)
- [Using Squiffy from the command line](usage.html)

Documentation
-------------

- [Sections and Passages](sections-passages.html)
- [Using JavaScript](javascript.html)
- [Importing Files](import.html) (command-line version only)
- [Turn Counting](turncount.html)
- [Clearing the screen](clear.html)
- [Attributes](attributes.html)
- [Customising HTML and CSS](customise.html) (command-line version only)
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

If you're using the web version, just hit the Publish button to share your game on textadventures.co.uk. You can also choose "Export HTML and JavaScript" from the Download menu, which will give you a ZIP file you can upload to any website.

If you're using the command-line version, you can create a ZIP file of Squiffy's output and [upload it to textadventures.co.uk](http://textadventures.co.uk/create/submit), or any website.

Contributing
------------

[Development Roadmap](roadmap.html)

If you find a bug, please log it on the [Issue Tracker](https://github.com/textadventures/squiffy/issues).

You can also discuss Squiffy at [the forum](http://forum.textadventures.co.uk/viewforum.php?f=24), or get technical help at [IF Answers](http://ifanswers.com).

Squiffy is completely open source, including this documentation! The source code and documentation both live [on GitHub](https://github.com/textadventures/squiffy) (documentation is in the `gh-pages` branch).