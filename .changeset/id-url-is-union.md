---
"semantic-selector": minor
---

When an element carries both a stable id and a url (an `<a id="buy-cta" href="/buy">`), emit both as an OR: `:is(#buy-cta, [href="/buy"])` rather than dropping the url because of the id. Either handle alone still resolves the element, so the selector now survives the id being changed *or* the href changing.
