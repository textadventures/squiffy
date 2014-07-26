---
layout: index
title: Replacing text
---

By creating labels, you can replace existing output when a link is clicked or when a passage or section is displayed.

```
I walked to the shops and I bought {label:1=a pint of milk}.
```

We can change the text for our label "1" in any link:

```
Or maybe [I bought something different?](@replace 1=a load of bread)
```

We can also change the text when a section or passage is displayed:

```
[next passage]
@replace 1=a bottle of whisky.

I changed my mind.
```

If the replacement text matches a section or passage name, the contents of that section or passage will be inserted instead.

```
I walked to the shops and I {label:1=bought a pint of milk}.

But I was [thinking](@replace 1=thoughts)...

[thoughts]:
suddenly thought, hang on, I could [[go to the funfair]] or [[join the circus]] instead.
```