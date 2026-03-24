# Duplicate Resolution

The user tried to save something similar to an existing note. Decide what to do.

## Output

Produce a JSON object with:
- `action`: one of `"ask"`, `"add_new"`, `"update"`

## Rules

- `ask`: prompt the user to choose ("add new" to save separately, "update" to replace)
- `add_new`: save as a new item even though it is similar
- `update`: replace the existing note with the new content

## When to choose each

- `ask`: default when it is unclear; let the user decide
- `add_new`: user phrasing suggests they want a separate entry (e.g. "also add", "and save this too")
- `update`: user phrasing suggests they want to replace (e.g. "change it to", "actually it should say")
