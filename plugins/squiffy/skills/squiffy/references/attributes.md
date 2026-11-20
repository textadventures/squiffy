# Attributes

Attributes are the story's variables. Docs: https://squiffystory.com/attributes/

## Squiffy 7 or Squiffy 6 rules

Which rules a story uses depends only on whether it has a `squiffy.json`:

| | Squiffy 7 (has `squiffy.json`) | Squiffy 6 (no `squiffy.json`) |
|---|---|---|
| Text | `@set weapon = "sword"` | `@set weapon = sword` |
| Another attribute | `@set best = score` | `@set best = @score` |
| In a link | `[[Go]](next, name = "Bob", gold += price)` | `[[Go]](next, name = Bob, gold += @price)` |

The same in both: numbers, `true`/`false`, `@set has_key`, `@set not has_key`, `@unset`, `:=`, `@inc`, `@dec`, and everything inside `{{...}}`.

In Squiffy 7, a bare word is an attribute: `@set weapon = sword` sets `weapon` to the value of an attribute called `sword`. Always quote text.

`npx @textadventures/squiffy-cli story.squiffy --convert-v6` converts a Squiffy 6 story and adds a `squiffy.json` (keeping `.bak` copies). Only do this if the author asks.

The rest of this file uses Squiffy 7 rules.

## Setting attributes

Directives, at the start of a section or passage. They always run when it's shown, whatever `{{#if}}` surrounds them:

```squiffy
@set score = 1000
@set player_name = "Alice"
@set best_score = score
@set gold = gold + price * 2
@set rich = gold > 100
@set status = hp > 0 ? "alive" : "dead"
@set has_key
@set not has_key
@unset has_key
@inc score
@inc score 100
@dec health 5
```

`@inc`/`@dec` take a whole number; for a calculation use `@set score += bonus * 2`.

| Syntax | Meaning |
|---|---|
| `a = "text"` | Set to text |
| `a = b` | Copy another attribute |
| `a = expression` | Calculation or comparison |
| `a += n`, `a -= n`, `a *= n`, `a /= n` | Numbers only |
| `a := text with {{name}}` | Text after processing `{{...}}` (no quotes) |

To join text: `@set title = name + " the Brave"`.

### From links

Comma-separated assignments after the target, working like `@set`. They run when the link is clicked:

```squiffy
[[Warrior]](start, class = "warrior", strength = 10)
[[Buy apple]](shop, coins -= 3)
[[Finish]](ending, final_score = score, bonus *= 2)
[[Say hello]](next, greeting = "Hello, friend", met = true)
[[Buy]](shop, gold -= (price - 1) * 2)
```

A comma inside quotes is part of the text.

### Conditionally, with helpers

To change an attribute only when an `{{#if}}` is true, use the helpers, which run where they appear in the text and output nothing:

```squiffy
{{#if (seen "helped the wizard")}}{{inc "reputation"}}The wizard remembers you.{{/if}}
```

`{{set "a" value}}`, `{{set "a" a + b * 2}}`, `{{unset "a"}}`, `{{inc "a"}}`, `{{inc "a" 5}}`, `{{dec "a"}}`, `{{dec "a" 3}}`. The attribute name is in quotes.

## Reading attributes

- `{{score}}` for a one-word name. `{{get "player name"}}` for a name with spaces, or `{{get room}}` to read the attribute named by `room`'s value.
- `{{= price * 2}}` shows a calculation.
- In conditions: `{{#if [player name] = "Bob"}}`.
- An attribute that hasn't been set is `0` in calculations, empty text when joined, and false in conditions.

## Conditions and calculations

Used in `{{#if}}`, `{{#unless}}`, `{{else if}}`, `@set`, link setters, `{{set}}`/`{{inc}}`/`{{dec}}` and `{{= }}`:

- Compare: `=` (or `==`), `!=`, `>`, `>=`, `<`, `<=`, `contains`
- Logic: `and`/`&&`, `or`/`||`, `not`/`!`
- Maths: `+`, `-`, `*`, `/`, `%`. **Put spaces around `-` and `/`**: `my-score` is an attribute name.
- Choice: `cond ? a : b`
- Precedence: maths, then comparisons, then `not`, `and`, `or`, then `? :`. Use parentheses to group.
- `+` adds numbers (including text holding a number, such as text-box input) and otherwise joins text. Other maths operators need numbers; dividing by zero shows an error.
- Helpers in expressions go in parentheses: `(seen "intro")`, `(length "bag") > 3`, `{{= (round (gold / 3))}}`.

## Tracking where the player has been

- `(seen "cave")`: has the player seen this section or passage. Looked up by name.
- `(visits "cave")`: how many times, or 0.
- `(at "cave")` or `(at (array "a" "b"))`: is the player in this section now. Useful in `[[]]:`.
- `turns`: links clicked in the whole story (not `{{goto}}`). Squiffy sets it; never set it yourself.
- `previous_section`: the section the player was in before. `previous`: the section or passage seen just before. Squiffy sets these; never set them yourself.

## Arrays

```squiffy
@set fruits = ["apple", "pear", "plum"]
{{set "bag" (array "rope" "lamp")}}
The second fruit is {{= fruits[1]}}.
{{append "bag" "key"}}
{{#if bag contains "key"}}...{{/if}}
{{#if (contains "bag" "key")}}...{{/if}}
You have {{bag.length}} things: {{join bag ", " " and "}}.
```

Helpers that change an array take its name in quotes (`append`, `prepend`, `pop`, `remove`, `contains`, `length`). Helpers that read one take the array itself (`join`, `sort`, `shuffle`, `slice`, `first`, `last`, `indexof`, `count`). See helpers.md.

### Going through an array

```squiffy
{{#each stock}}
- [[Buy the {{this}}]](bought, item = "{{this}}", gold -= 2)
{{else}}
Nothing left.
{{/each}}
```

- `{{@index}}` is the position from 0; `@first` and `@last` are true for the first and last items.
- In link setters, quote `"{{this}}"`: setters run on click, after the loop, so `item = this` doesn't work.
- Repeat a number of times: `{{#each (range 1 lives)}}♥{{/each}}`.
- A passage link inside `{{#each}}` works on its own: clicking one item's link turns off just that one.

## Objects

```squiffy
@set hero = { name: "Ann", hp: 10, gold: 5 }
{{hero.name}} has {{hero.hp}} HP.
[[Rest]](inn, hero.hp += 5, hero.gold -= 2)
@set hero.poisoned
@set party = [{ name: "Ann", hp: 10 }, { name: "Bo", hp: 4 }]
{{= party[leader].name}} leads.
```

- Setting `hero.hp` makes `hero` if it doesn't exist.
- Names with spaces: `{ "max hp": 12 }` and `hero["max hp"]`; `hero[stat]` uses another attribute's value.
- `@set best = hero` copies the object.
- Helpers take a path: `{{inc "hero.hp" 5}}`, `{{live "hero.hp"}}`; JavaScript: `squiffy.get("hero.hp")`, `squiffy.set("party.0.name", "Ann")`.
- Use `{{= }}` to show a value at a position: `{{= party[leader].name}}`. A plain dotted path like `{{hero.hp}}` doesn't need it.
- `hero contains "hp"` is whether the object has that value.
