---
layout: index
title: Using Squiffy
---

Pass a Squiffy script file as a command-line argument.

    python squiffy.py example.squiffy
    
Squiffy will write three files to the same folder as the script file: index.html, style.css and story.js. It will also write a copy of the jQuery and jQuery UI scripts which are required.

This folder of files can now be uploaded anywhere and run entirely locally in the player's web browser (the source .squiffy script file does not need to be included).

If you prefer the player's browser to fetch jQuery and jQuery UI from a CDN instead of including a local copy, pass the -c option:

    python squiffy.py example.squiffy -c
