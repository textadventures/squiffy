Squiffy
=======

Squiffy is a tool for creating interactive fiction.

This Github project is for the Squiffy compiler. It reads in a Squiffy script file, and outputs HTML, CSS and JavaScript.

The Squiffy compiler has been tested with Python 2.7 and Python 3.3.

Using Squiffy
-------------

Pass a Squiffy script file as a command-line argument.

    python squiffy.py example.squiffy
    
Squiffy will write three files to the same folder as the script file: index.html, style.css and story.js. These can be uploaded anywhere and run entirely locally in the player's web browser.

Squiffy Scripts
---------------

We can write Hello World with no markup at all:

    Hello, World!
    
But the whole point of using Squiffy is to create interactive stories, so let's add some links. There are two types of text block you can use in Squiffy:

- **Sections** are the main units of text.
- **Passages** are smaller units which exist within sections.

Taking the player to a new section will deactivate all previous links, so use a new section when the player has taken some action to move the story forward.

Within a section, you can link to passages. After the player clicks a link to a passage, links to other passages in the same section will remain active.

Sections
--------

To link to a section, use double square brackets.

    Do you want to have the [[roast chicken]] or skip straight to [[dessert]]?
    
Set up a section using double square brackets, followed by a colon.

```
[[roast chicken]]:
This plate of roast chicken looks delicious.

[[dessert]]:
Three different flavours of ice cream - yum!
```

Passages
--------

To link to a passage, use single square brackets.

    Looking around the room, you can see a [TV], a [book] and a piece of [paper] with some handwriting scribbled on it.
    
Set up a passage using single square brackets, followed by a colon. Passages can link to further passages. After the player clicks a link to a passage, that link is deactivated, so the player can only click it once.

```
[TV]
Covered in dust and the plug is missing.

[book]
It's a book of magic tricks. Maybe you should [open] it?

[open]
The cover opens up to reveal the pages all glued together, with an empty key-shaped hole cut out.

[paper]
"Gone out for a walk. May be a while."
```

Passage links can be explored in any order - in the example above, the player might look at the book first, then look at the TV, then open the book. Only after clicking a link the next section will any remaining passage links be deactivated.
