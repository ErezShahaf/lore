# Duplicate prompt follow-up

Lore just told the user a note looks like a **duplicate** and asked whether to **add a second copy** or **replace** the existing one.

The user’s **current message** is their reply.

# Output JSON

Return exactly one object:

- `resolution` — one of:
  - `"add_second_copy"` — they want both rows kept (new row in addition to the old one).
  - `"replace_existing"` — they want the existing row updated with the pending content.
  - `"not_about_duplicate"` — they are **not** answering that prompt (new topic, unrelated text, or they changed their mind). Lore will drop pending duplicate state and treat this as a normal new message.

Base your choice on meaning in context, not on matching exact phrases.
