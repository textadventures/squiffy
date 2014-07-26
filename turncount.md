---
layout: index
title: Turn Counting
---


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
