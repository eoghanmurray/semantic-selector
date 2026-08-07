---
"semantic-selector": minor
---

Generate selectors with a page-independent identity ratchet, and reject more machine-generated ids/classes.

Selector generation is much more deterministic as we've removed all querying across the entire page (document.querySelectorAll)
 - the redundant-ancestor pruner: gone
 - weak-id/strong-id two-pass: gone
 - duplicate-id-on-page rescue: gone

Speeds up selector generation and ensures that a given subtree yields the same selector regardless of what else is on the page.
We also shorten the selector by only adding ancestors which have a higher-ranking type (id > class > framework class etc.)

Also:

- Reject high-entropy `ULID`/`nanoid`/base32 token ids (e.g. `rich-text-016JB91MZ80000000000036PNV`).
- Reject: CSS-Modules / build-tool hashed classes (`Card-cardContent-Zu3Ce`)
- For above, we do add the stem as a last resort `[class*="Card-cardContent"]`
- Better and more rejection of transient interaction-state classes (`pressed`, `expanded`, `dragging`, `paused`, etc.)