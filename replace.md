---
layout: index
title: Replacing text
---

*Note: the examples on this page all update at the same time, as the "replace" functionality doesn't currently handle the case where there are multiple Squiffy outputs on one page. This will be fixed soon.*

By creating labels, you can replace existing output when a link is clicked or when a passage or section is displayed. In the example below, we create a label called "1", and we change the text in that label using a link:

{% include sample.html file="replace" %}

We can also change the text when a section or passage is displayed:

{% include sample.html file="replace2" %}

If the replacement text matches a section or passage name, the contents of that section or passage will be inserted instead.

{% include sample.html file="replace3" %}