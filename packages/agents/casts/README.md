# Casts

A cast is a sitcom's ensemble mapped onto the company roles. Pick one in a
company file with `cast: the-office` and every role gets that show's
character name and title; the client draws the matching look when it knows
the first name (see `LOOKS` in `apps/client/src/world/character.ts`).

```json
{
  "id": "the-office",
  "show": "The Office (US)",
  "company": { "name": "Dunder Mindflin", "tagline": "..." },
  "cast": {
    "ceo": { "name": "Michael", "title": "Regional Manager" },
    "pm":  { "name": "Jim", "title": "Sales, Reluctantly" }
  }
}
```

- Names are first names only, and titles are our own jokes. No dialogue,
  catchphrases or other material from the shows is included anywhere.
- A role missing from a cast falls back to the random name list.
- Personality still comes from `roles/*.md` and per-company
  `agents/<role>.md` overrides, so a cast is a costume, not a script.

Casts here: `the-office`. Planned: `parks-and-rec`, `silicon-valley`,
`it-crowd`, `brooklyn-99`, `seinfeld`.
