# semantic-selector

## 0.2.0

### Minor Changes

- 9a88dd9: Generate selectors with a page-independent identity ratchet, and reject more machine-generated ids/classes.

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

### Patch Changes

- 34714de: Cap the length of URL-based selectors in a deterministic way so a long `href`/`src` no longer produces a huge selector.

  Previously a link whose URL had a meaningful query string was recorded in full (e.g. a 250-char faceted-search `href`). Once the matched value exceeds 64 characters we now only record a subset of it

  - Short URLs still match in full (`[href="..."]` i.e. exact)
  - Long URLs match with "endswith" i.e. `[href$="…tail"]` on the basis that there is more 'identity' at the end of the href
  - If we think the query string is volatile (?gclid=<some-hash>), we can use prefix matching (`[href^="..."]`) so long as it fits within the limits
  - if that prefix is still too long we try to pick a distinctive part of the url to match against (`[href*="…"]` )

- 3d64694: When we've got a descendant selector that targets a div, which could potentially extend to lots of other divs, make sure that we anchor it to it's immediate parent using a direct-child combinator. Do not apply this rule to other non-container-like tags such as <i> etc. which normally don't nest; allow an insertion of a new intermediary container to not upset the selector (e.g. `#abc > i` would break if the dom became `#abc > div > i`
- 7d81194: Improve e.g. bare <p> targets by identifying the paragraph using anchor href's that it contains e.g. `p:has(> a[href="/buy"])`. This generalises the existing `:has(> #id)`
- 0bee2bc: Pin `:has(#id)` anchors to the id's exact parent so they no longer over-match. A loose `:has(#id)` matches every ancestor on the id's spine up to `<body>`, as every parent also includes that #id element. Instead, emit a child-combinator path from the id's depth — `:has(> #id)` for a direct child, `:has(> * > #id)` for a grandchild — isolating the single element that parents the id. The search is capped at two levels deep, so a coincidental deep id is ignored rather than anchored with a fragile long path.
- 32036e4: Use HTML structure such as `tbody td` and `ol > li` when we'd otherwise use bare `td` or `li`

## 0.1.1

### Patch Changes

- cea2c77: Accept a `ShadowRoot` as the `root` argument to `semanticSelector`, so selectors can be generated within a shadow tree as well as from a regular `Element`.
