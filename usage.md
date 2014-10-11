---
layout: index
title: Using Squiffy
---

You can create a Squiffy file in any text editor - Notepad, [Sublime Text](http://www.sublimetext.com/), TextEdit etc.

Squiffy files are text files with a `.squiffy` file extension.

To transform a Squiffy file into a working browser-based game, go to its directory in a command prompt and type:

	squiffy mygame.squiffy

Squiffy will write three files to the same folder as the script file: `index.html`, `style.css` and `story.js`. It will also write a copy of the jQuery and jQuery UI scripts - see the note below if you prefer the game to fetch these over the web instead.

Launch `index.html` to play the game.

This folder of files can now be uploaded anywhere, and it will run entirely locally in the player's web browser (the source `.squiffy` script file does not need to be included).

The browser's local storage will be used to save the state of the game. This means the player can close their browser, and the next time they go back to that page, the game will resume from where they left off.

**Note: Even if you recompile a game, the previous state will still be loaded.** This means that after making a change to your game, you'll need to click the Restart link at the top of the screen to see your changes.

Getting jQuery and jQueryUI from a CDN
--------------------------------------

If you prefer the player's browser to fetch jQuery and jQuery UI from a CDN instead of including a local copy, pass the -c option:

    squiffy mygame.squiffy -c
