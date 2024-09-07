# Squiffy Editor

This repository contains the code for the Squiffy Editor, which is packaged as both a website and a
downloadable desktop application for Windows, OS X and Linux.

The website version can be found at http://textadventures.co.uk/squiffy/editor.

The Squiffy Compiler is in a [separate repository](https://github.com/textadventures/squiffy).

To build the desktop version:

- install Node
- install Bower: `npm install bower -g`
- install Gulp: `npm install gulp-cli -g`
- clone this repository
- run `npm install` to get the Node packages
- run `bower install` to get the Bower packages

You can now run the Squiffy Editor using `npm start`. (You can also run it in a web browser using `npm run-script web`
and going to `http://localhost:8282`)

To package the desktop app, a script is provided for each platform:

- `gulp osx` creates `Squiffy-darwin-x64\Squiffy.app`
- `gulp linux` creates `Squiffy-linux-x64\Squiffy`
- `gulp windows` creates `Squiffy-win32-ia32\Squiffy.exe`
