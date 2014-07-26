---
layout: index
title: Rotate and Sequence
---

For a text link that replaces itself each time it is clicked:

    {rotate:one:two:three}

This will give a link that says "one". When clicked, the link text will change to "two", then "three", then back to "one".

You can store the result in an attribute:

    {rotate size:small:medium:large}

If you don't want a rotating list, use a sequence instead. The final option won't be a link.

    {sequence:Ready:Steady:Go}

As a variation on this, you can use a section link as the final option in a sequence.

    {sequence:Click me:Click me again:[[And once more]](next)}
