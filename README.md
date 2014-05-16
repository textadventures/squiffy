Squiffy
=======

Squiffy is a tool for creating interactive fiction.

This Github project is for the Squiffy compiler. It reads in a Squiffy script file, and outputs HTML, CSS and JavaScript. A player's game state is saved automatically to Local Storage.

The Squiffy compiler has been tested with Python 2.7 and Python 3.3. To run it you will need to install the [Markdown package](https://pypi.python.org/pypi/Markdown).

Squiffy is under development. A binary release of the compiler will be made available for Windows and Mac OS X. There will eventually be a web-based editor too. The aim is to create a lightweight and flexible tool for interactive stories that lets you simply sit down and write.

Using Squiffy
-------------

Pass a Squiffy script file as a command-line argument.

    python squiffy.py example.squiffy
    
Squiffy will write three files to the same folder as the script file: index.html, style.css and story.js. It will also write a copy of the jQuery and jQuery UI scripts which are required.

This folder of files can now be uploaded anywhere and run entirely locally in the player's web browser (the source .squiffy script file does not need to be included).

If you prefer the player's browser to fetch jQuery and jQuery UI from a CDN instead of including a local copy, pass the -c option:

    python squiffy.py example.squiffy -c

Squiffy Scripts
---------------

We can write Hello World with no markup at all:

    Hello, World!
    
You can format text using [Markdown](http://daringfireball.net/projects/markdown/syntax), and also use HTML.

To create interactive stories, we'll need to add some links. There are two types of text block you can use in Squiffy:

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

Section names must be unique within a story.

To use different link text, put the name of the section in brackets afterwards.

    This is [[how to use custom link text]](section2).

Passages
--------

To link to a passage, use single square brackets.

```
Looking around the room, you can see a [TV], a [book] and a piece
of [paper] with some handwriting scribbled on it.
```
    
Set up a passage using single square brackets, followed by a colon. Passages can link to further passages. After the player clicks a link to a passage, that link is deactivated, so the player can only click it once.

```
[TV]:
Covered in dust and the plug is missing.

[book]:
It's a book of magic tricks. Maybe you should [open] it?

[open]:
The cover opens up to reveal the pages all glued together, with an empty key-shaped hole cut out.

[paper]:
"Gone out for a walk. May be a while."
```

Passage links can be explored in any order - in the example above, the player might look at the book first, then look at the TV, then open the book. Only after clicking a link to another section will any remaining passage links be deactivated.

Passage names must be unique within their section.

To use different link text, put the name of the passage in brackets afterwards.

    This is [how to use custom link text](passage1).

JavaScript
----------

Any section or passage can call some JavaScript when it is displayed. Simply indent with four spaces or a tab, before the text.

```
Clicking this [link] will show an alert.

[link]:

    alert ("Hello!");
    
Text for the passage.
```

Importing files
---------------

You can split your script up into multiple files and import them:

    @import other_file.squiffy
    
You can also use the same syntax to import external JavaScript files:

    @import my_script.js
    
This syntax also accepts wildcards, so you can include all .squiffy files in a directory:

    @import *.squiffy

Turn counting
-------------

You can trigger a passage after the player has made a certain number of clicks within a section. For example, you can display some extra text, to indicate the passage of time. Or, the passage might run some JavaScript to automatically move the player to another section.

```
On the train you can see a [girl singing], a [man reading a book] and an [old woman].

[girl singing]:
She is nodding her head to the music in her enormous earphones, and singing badly out of tune.

[man reading a book]:
He's been reading the same page of *War and Peace* for a while now.

[old woman]:
She eyes you suspiciously, as if she has seen your type before.

[@1]:
We're nearly here. The train is pulling into the platform.

[@2]:

    squiffy.story.go("station");
```

Clearing the screen
-------------------

Any section or passage can clear the screen using @clear on a line on its own:

    [[Chapter 2]]
    @clear
    My first reaction to the explosion was...

Setting attributes
------------------

You can set an attribute within a section or passage like this:

    @set score = 1000

If the value is a number, it will be stored as a number. Otherwise, it will be stored as a string.

For boolean (true/false) values, to set as true:

    @set my_true_value
    
and to set as false:

    @set not my_false_value
    
or alternatively:

    @unset my_false_value
    
For number values, you can increase or decrease the value by 1:

    @inc score
    @dec health

You can also set an attribute value from a link:

```
Are you [[male]](start, gender=male) or [[female]](start, gender=female)?

[[start]]:
Your choice has been recorded.
```

And you can also set a value in JavaScript:

```
    squiffy.set("gender", "female");
```

Reading attributes
------------------

You can display the value of an attribute by surrounding it with curly brackets.

```
You chose {gender}.
```

You can also read a value using JavaScript:

```
    var gender = squiffy.get("gender");
```

You can conditionally display text depending on the value of an attribute using "if" inside curly brackets. You can also use "else":

```
{if gender=male:You are a man.}{else:You are a woman.}
```

Customising HTML and CSS
------------------------

The index.template.html and story.template.css files are customisable. It is better not to edit the ones in your Squiffy directory - you can copy them to the same directory as your .squiffy story script file, and make edits there instead.

Embedding text
--------------

You can embed text from another section, or from a passage in the current section, by surrounding its name with curly brackets.

```
[[section1]]:
Here is some text from the next section: {section2}

Here is some text from a passage in this section: {passage}

[passage]:
Text from passage.

[[section2]]:
Text from next section.
```

Tracking which sections and passages have been seen
---------------------------------------------------

You can tell if the player has seen a passage or section using JavaScript:

```
    if (squiffy.story.seen("passage3")) alert ("You have seen passage3!");
```

You can also conditionally display text:

```
You can see a [cupboard]. Maybe you should [open] it?

[open]:
You open the cupboard.

[cupboard]:
The cupboard is {if seen open:open, and there are empty bottles inside}{else:closed}.
```

Setting the start section
-------------------------

By default, the story begins in the first section. You can choose a different section like this:

```
@start Beginning

[[some other section]]:
This section would normally be the start, but we have overridden it.

[[Beginning]]:
This is where the story begins.
```

Setting the title
-----------------

Set the title like this:

```
@title My Amazing Interactive Story
```

"Continue" links
----------------

Where you have a section with one link that simply goes to the following section, you can automatically create a "Continue" link like this:

```
This is the first part of my story.

+++Continue...

This is the second part.

+++I want to hear more...

Very well. Here is the third part.
```
