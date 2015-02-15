---
layout: index
title: Turn Counting
---

You can trigger a passage after the player has made a certain number of clicks within a section. For example, you can display some extra text, to indicate the passage of time. Or, the passage might run some JavaScript to automatically move the player to another section.

In the example below, the text "We're nearly here. The train is pulling into the platform." is always written after the first passage click. After the second passage click, we are moved into the next section.

{% include sample.html file="turncount" %}