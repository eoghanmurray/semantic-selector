---
"semantic-selector": patch
---

Cap the length of URL-based selectors in a deterministic way so a long `href`/`src` no longer produces a huge selector.

Previously a link whose URL had a meaningful query string was recorded in full (e.g. a 250-char faceted-search `href`). Once the matched value exceeds 64 characters we now only record a subset of it

- Short URLs still match in full (`[href="..."]` i.e. exact)
- Long URLs match with "endswith" i.e. `[href$="…tail"]` on the basis that there is more 'identity' at the end of the href
- If we think the query string is volatile (?gclid=<some-hash>), we can use prefix matching (`[href^="..."]`) so long as it fits within the limits
- if that prefix is still too long we try to pick a distinctive part of the url to match against (`[href*="…"]` )

