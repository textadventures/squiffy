---
layout: index
title: Using Squiffy from the command line
redirect_from:
    - "install.html"
    - "usage.html"
---

Installing
----------

As an alternative to the [web version](http://textadventures.co.uk/squiffy/editor) and the downloadable graphical editor, Squiffy is also available as a command-line Node package. This runs on Windows, Mac and Linux.

To install the Squiffy compiler, first [install Node.js](http://nodejs.org/).

Next, install the [squiffy package](https://www.npmjs.org/package/squiffy) from npm, by typing this into a Command Prompt or Terminal:

    npm install squiffy -g

The `-g` option installs the Squiffy compiler globally, so you can easily run it from any directory.

**If the install fails:** On a Mac or Linux, if you get an error installing, try using `sudo`:

    sudo npm install squiffy -g

Usage
-----

You can create a Squiffy file in any text editor - Notepad, [Sublime Text](http://www.sublimetext.com/), TextEdit etc.

Squiffy files are text files with a `.squiffy` file extension.

To transform a Squiffy file into a working browser-based game, go to its directory in a command prompt and type:

    squiffy mygame.squiffy

Squiffy will write three files to the same folder as the script file: `index.html`, `style.css` and `story.js`. It will also write a copy of jQuery (use the `--cdn` option to fetch this over the web instead).

Launch `index.html` to play the game.

This folder of files can now be uploaded anywhere, and it will run entirely locally in the player's web browser (the source `.squiffy` script file does not need to be included).

The browser's local storage will be used to save the state of the game. This means the player can close their browser, and the next time they go back to that page, the game will resume from where they left off.

**Note: Even if you recompile a game, the previous state will still be loaded.** This means that after making a change to your game, you'll need to click the Restart link at the top of the screen to see your changes.

Options
-------

### CDN

Use `--cdn` to fetch jQuery from a CDN instead of including a local copy.

### HTTP Server

Use `--serve` to start a local HTTP server after compiling. Optionally, you can also specify a port using `--port`, e.g.

    squiffy mygame.squiffy --serve --port 31337

### Script only

Use `--scriptonly` to generate *only* the `story.js` file. You can optionally specify your own name, e.g.

    squiffy mygame.squiffy --scriptonly myscript.js

### Plugin name

Squiffy generates a JavaScript file which includes a jQuery plugin, allowing you to embed your game in any HTML element. By default this plugin is called using:

    $('#element').squiffy()

If you have multiple Squiffy games in one HTML page, you need to use a different plugin name for each one. You can specify the plugin name using the `--pluginname` option.

For example:

    squiffy mygame.squiffy --scriptonly --pluginname mygame

This will generate a `story.js` file containing a jQuery plugin, which you can attach to any element of an HTML page using

    $('#element').mygame();