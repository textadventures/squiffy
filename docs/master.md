---
layout: index
title: Master sections and passages
---

An empty name for a section or passage creates a "master", which is triggered for every section or passage in the game. (A master passage defined in a named section will only be triggered for every passage in that section)

e.g. to clear the screen before every section, and to increase a global turn counter:

```
[[]]:
@clear
@inc turns
    if (squiffy.get("turns") > 5) ...
```
