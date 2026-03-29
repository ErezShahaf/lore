# Duplicate prompt follow-up

Lore just told the user one or more **similar** items are already in the library and asked whether to **add another copy anyway** or **replace** a match (replace applies to the **first** similar item Lore listed).

The user’s **current message** is their reply.

# Output JSON

Return exactly one object:

- `resolution` — one of:
  - `"add_second_copy"` — they want both rows kept (new row in addition to the old one).
  - `"replace_existing"` — they want an existing row updated with the pending content (the first listed similar item when several were shown).
  - `"not_about_duplicate"` — they are **not** answering that prompt (new topic, unrelated text, or they changed their mind). Lore will drop pending duplicate state and treat this as a normal new message. Also use this when they **pivot to a different measured task** than the pending one (for example pending was “run 5 km” and they now ask for “run 6 km”)—that is a new save, not “add another copy” of the pending text.

Base your choice on meaning in context, not on matching exact phrases.
