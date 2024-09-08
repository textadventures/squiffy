---
layout: index
title: Tracking which sections and passages have been seen 
---

You can tell if the player has seen a passage or section using JavaScript:

```
    if (squiffy.story.seen("passage3")) alert ("You have seen passage3!");
```

You can also conditionally display text:

{% include sample.html file="seen" %}