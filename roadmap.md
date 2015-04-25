---
layout: index
title: Roadmap
---

Ideally there should only be one major new feature per release, and releases should be frequent. The current plan is below - all of it is subject to change of course!

You can get involved by contributing [on GitHub](https://github.com/textadventures/squiffy), or discussing Squiffy at [the forum](http://forum.textadventures.co.uk/viewforum.php?f=24).

## Squiffy 1

**Status:** Released 26 July 2014.

This release of Squiffy is a simple command-line Python script.

## Squiffy 2

**Status:** Released 11 October 2014.

This release is a re-write of the Squiffy compiler to use [Node.js](http://nodejs.org/) instead of Python. This enables the compiler to run easily pretty much anywhere - as a web service, or as part of a desktop application (using [node-webkit](https://github.com/rogerwang/node-webkit)). It also means all of Squiffy - both the compiler and the run-time - is now written using one language, JavaScript.

## Squiffy 3

**Status:** Released 25 April 2015.

This is the first release of Squiffy to have a web-based editor, so you can now use it without downloading anything. To start with, it is a very simple editor - pretty much just a text editor to edit the raw script file. The output can be downloaded, or published directly to [textadventures.co.uk](http://textadventures.co.uk/).

## Squiffy 4

**Status:** In development

This will be the first downloadable version of the Squiffy editor. It will be the same web-based editor as first created for Squiffy 3, but packaged using [Electron](http://electron.atom.io/) or possibly [NW.js](http://nwjs.io/) (formerly node-webkit).

## Squiffy 5

We can start to flesh out the features of the editor. The most important feature for the first editor iteration is probably a graphical view of a game's sections and passages, so the overall structure of a game can be visualised.