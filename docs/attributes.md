---
layout: index
title: Attributes
---


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

Or to increase or decrease by other amounts:

	@inc score 100
	@dec health 5

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

You can also set an attributes values in if clause, add "{@ operations}" after condition colon(:), like this:

```
    {if a=1:{@b+=1,c-=1,d=2,not e}}{else:{@b+=2,c+=2,d=3,e}}
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

Or you can compare two attributes, add @ before second attribute, it is treated as a squiffy attribute not value:

```
{if a=@b:attribute value a and attribute value b are equals.}{else:Are differtents.}
```