---
layout: index
title: Squiffy - Documentation
---

Squiffy is a tool for creating interactive fiction - that is, multiple choice games that focus on text and story. Players navigate through the game or story by clicking links. Sometimes these kinds of games or stories are known as [gamebooks](http://en.wikipedia.org/wiki/Gamebook).

Squiffy is free and open source. It creates HTML and JavaScript, so you can upload it to your own website, or to a site like [itch.io](https://itch.io/) or [textadventures.co.uk](https://textadventures.co.uk).

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

You can find Squiffy at [app.squiffystory.com](https://app.squiffystory.com/).

Example
-------

{% include sample.html file="example" %}

Publishing your game
--------------------

Squiffy creates HTML, CSS and JavaScript files, which you can upload anywhere. You don't need to distribute your source `.squiffy` file - everything that is needed for the game to run is contained in the HTML and JavaScript.

If you're using the web version, just hit the Publish button to share your game on textadventures.co.uk. You can also choose "Export HTML and JavaScript" from the Download menu, which will give you a ZIP file you can upload to any website.

If you're using the app for Windows, MacOS or Linux, hit the Build button to create the HTML, CSS and JavaScript files in the same directory as the game file. This will also open the results in your web browser for you to preview.

Contributing
------------

[Squiffy GitHub repository](https://github.com/textadventures/squiffy)

If you find a bug, please log an [issue](https://github.com/textadventures/squiffy/issues).

You can discuss Squiffy on [the textadventures.co.uk forums](https://textadventures.co.uk/forum/squiffy) or at [infiction.org](https://intfiction.org/tag/squiffy) (using the `squiffy` tag).

Squiffy is completely open source, including this documentation! The source code and documentation both live [on GitHub](https://github.com/textadventures/squiffy) (documentation is in the `docs` folder).