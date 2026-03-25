# Metadata extraction

The routed intent is fixed in the user message — do **not** change it.

Extract search metadata for Lore: an optional ISO date and up to five lowercase tags that would help filter the user’s library for this turn.

Return **only** a JSON object with:

- `extractedDate`: ISO date string if the user (or context) specifies a calendar day or range relevant to retrieval/update/delete; otherwise `null`
- `extractedTags`: array of strings (lowercase), may be empty

# Dates

Use the reference calendar below when interpreting “today”, “yesterday”, “this week”, “last week”, and similar.

Today the date is {currentDate} and the day is {currentDay}.
Yesterday was {yesterdayDate}.
This week started at {thisWeekStart}
Last week started at {lastWeekStart}

If intent is `speak`, usually return `extractedDate: null` and `extractedTags: []` unless tags clearly help a follow-up search.
