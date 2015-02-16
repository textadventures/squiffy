---
layout: index
title: Sections and Passages
---

You can write Hello World with no markup at all:

    Hello, World!
    
You can format text using [Markdown](http://daringfireball.net/projects/markdown/syntax), and also use HTML.

To create interactive stories, we'll need to add some links. There are two types of text block you can use in Squiffy:

- **Sections** are the main units of text.
- **Passages** are smaller units which exist within sections.

Taking the player to a new section will deactivate all previous links, so use a new section when the player has taken some action to move the story forward.

Within a section, you can link to passages. After the player clicks a link to a passage, links to other passages in the same section will remain active.

Sections
--------

Section names must be unique within a story. Set up a section using double square brackets, followed by a colon. To link to a section, use double square brackets.

{% include sample.html file="sections" %}

To use different link text, put the name of the section in brackets afterwards.

    This is [[how to use custom link text]](section2).

Passages
--------

Set up a passage using single square brackets, followed by a colon. Passages can link to further passages. After the player clicks a link to a passage, that link is deactivated, so the player can only click it once. To link to a passage, use single square brackets.

{% include sample.html file="passages" %}

Passage links can be explored in any order - in the example above, the player might look at the book first, then look at the TV, then open the book. Only after clicking a link to another section will any remaining passage links be deactivated.

Passage names must be unique within their section.

To use different link text, put the name of the passage in brackets afterwards.

    This is [how to use custom link text](passage1).