---
layout: index
title: Using Squiffy
---

You can create a Squiffy file in any text editor - Notepad, [Sublime Text](http://www.sublimetext.com/), TextEdit etc. It's probably easiest to make a new folder inside your Squiffy folder and put it there.

Squiffy files are text files with a `.squiffy` file extension.

If your new folder is called `mygame` and your Squiffy file is `mygame.squiffy` then you can go to a command prompt and type:

	python squiffy.py mygame/mygame.squiffy

Squiffy will write three files to the same folder as the script file: `index.html`, `style.css` and `story.js`. It will also write a copy of the jQuery and jQuery UI scripts - see the note below if you prefer the game to fetch these over the web instead.

Double-click `index.html` to play the game.

This folder of files can now be uploaded anywhere, and it will run entirely locally in the player's web browser (the source .squiffy script file does not need to be included).

The browser's local storage will be used to save the state of the game. This means the player can close their browser, and the next time they go back to that page, the game will resume from where they left off.

Getting jQuery and jQueryUI from a CDN
--------------------------------------

If you prefer the player's browser to fetch jQuery and jQuery UI from a CDN instead of including a local copy, pass the -c option:

    python squiffy.py mygame/mygame.squiffy -c
