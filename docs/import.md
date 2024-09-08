---
layout: index
title: Importing Files
---

*Importing files only works in the command-line version of Squiffy*

You can split your script up into multiple files and import them:

    @import other_file.squiffy
    
You can also use the same syntax to import external JavaScript files:

    @import my_script.js
    
This syntax also accepts wildcards, so you can include all .squiffy files in a directory:

    @import *.squiffy
