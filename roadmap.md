---
layout: index
title: Roadmap
---

Instead of "big bang" releases, the roadmap for Squiffy consists of a sequence of [Minimum Viable Products](http://en.wikipedia.org/wiki/Minimum_viable_product). Ideally there should only be one major new feature per release, and releases should be frequent.

The current plan is below - all of it is subject to change of course!

You can get involved by contributing [on GitHub](https://github.com/textadventures/squiffy), or discussing Squiffy at [the forum](http://forum.textadventures.co.uk/viewforum.php?f=24).

## Squiffy 1

**Status:** Released 26 July 2014.

This release of Squiffy is a simple command-line Python script.

## Squiffy 2

**Status:** Released 11 October 2014.

This release is a re-write of the Squiffy compiler to use [Node.js](http://nodejs.org/) instead of Python. This enables the compiler to run easily pretty much anywhere - as a web service, or as part of a desktop application (using [node-webkit](https://github.com/rogerwang/node-webkit)). It also means all of Squiffy - both the compiler and the run-time - is now written using one language, JavaScript.

## Squiffy 3

This will be the first release of Squiffy that runs over the web, so people can use it without downloading or installing anything. For this version, the "editor" will simply allow a file to be uploaded. This will call the compiler, and a ZIP file of the generated HTML, CSS and JS can be downloaded.

## Squiffy 4

This release will feature a simple JavaScript text editor, packaged as a desktop app using node-webkit.

## Squiffy 5

The JavaScript text editor introduced in Squiffy 4 will be implemented in the web version of Squiffy. Users will be able to log in at textadventures.co.uk to access this, with their files stored in the cloud.

## Squiffy 6

With both web and desktop editors now in sync, we can start to flesh out the features of the editor. The most important feature for the first editor iteration is probably a graphical view of a game's sections and passages, so the overall structure of a game can be visualised.