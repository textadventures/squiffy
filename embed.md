---
layout: index
title: Embedding Text
---

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
