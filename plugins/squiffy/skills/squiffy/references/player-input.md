# Player input

Docs: https://squiffystory.com/player-input/

An HTML input with `data-attribute` stores what the player types in that attribute:

```squiffy
What is your name?

<input type="text" data-attribute="player_name" placeholder="Enter your name...">

[[Begin the adventure]](begin)

[[begin]]:
Welcome, {{player_name}}!
```

`<select data-attribute="...">` and `<textarea data-attribute="...">` work too.

## Validation

With HTML validation attributes, section and passage links are disabled until every input is valid:

```squiffy
Name: <input type="text" data-attribute="name" required minlength="2">
Age: <input type="number" data-attribute="age" required min="1" max="120">
Email: <input type="email" data-attribute="email" required>
```

Supported: `required`, `minlength`, `maxlength`, `min`, `max`, `pattern`, and `type` (`email`, `url`, `number`...).

## Using the input

- Input is text. `+` treats text holding a number as a number, so `age + 1` works. Compare with `lower` to ignore case: `{{#if (lower answer) = "yes"}}`.
- `{{player_name}}` escapes the text, so it's safe to show. A custom helper that builds HTML must escape input itself (javascript.md).

## Testing

`--play --input player_name=Ann` fills the text box for `player_name` when it's on screen. Give one `--input` for each box. `--random` fills boxes with something that fits their validation.
