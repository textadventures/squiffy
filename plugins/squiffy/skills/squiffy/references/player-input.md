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

Give every box a label for screen readers: wrap it with the text before it, `<label>Name: <input ...></label>`, or give it an `aria-label="Your name"`. A `placeholder` alone disappears once the player types. `data-attribute` can be a value inside an object: `data-attribute="hero.name"`.

The runtime gives text boxes `autocomplete="off"` and the attributes that tell password managers (1Password, LastPass, Bitwarden, Dashlane) not to fill them in, unless the box has an `autocomplete` attribute of its own, such as `autocomplete="given-name"`.

## Going on when Enter is pressed

`data-section` on an `<input>` goes to that section when the player presses Enter, like clicking a link to it; `data-passage` shows a passage. What was typed is stored first, so the section or passage can use it:

```squiffy
What is your name? <input type="text" data-attribute="player_name" data-section="begin" aria-label="Your name" required>

[[begin]]:
Welcome, {{player_name}}!
```

- A text box with `data-passage` works once, like a passage link, unless the passage has `@repeat` (good for guessing games).
- Enter does nothing until every text box in the section is valid.
- Not on `<textarea>`, where Enter starts a new line.
- The editor and `--check` treat it as a link: missing targets are warned about, and it counts for reachability and dead ends.

## Validation

With HTML validation attributes, section and passage links are disabled until every input is valid:

```squiffy
<label>Name: <input type="text" data-attribute="name" required minlength="2"></label>
<label>Age: <input type="number" data-attribute="age" required min="1" max="120"></label>
<label>Email: <input type="email" data-attribute="email" required></label>
```

Supported: `required`, `minlength`, `maxlength`, `min`, `max`, `pattern`, and `type` (`email`, `url`, `number`...).

## Using the input

- Input is text. `+` treats text holding a number as a number, so `age + 1` works. Compare with `lower` to ignore case: `{{#if (lower answer) = "yes"}}`.
- `{{player_name}}` escapes the text, so it's safe to show. A custom helper that builds HTML must escape input itself (javascript.md).

## Testing

`--play --input player_name=Ann` fills the text box for `player_name` when it's on screen. A text box that goes somewhere when Enter is pressed is one of the choices, "Press Enter in the text box for player_name", which `--choose` takes by that text or its number. Give one `--input` for each box. `--random` fills boxes with something that fits their validation.
