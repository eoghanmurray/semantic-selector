---
"semantic-selector": patch
---

Pin `:has(#id)` anchors to the id's exact parent so they no longer over-match. A loose `:has(#id)` matches every ancestor on the id's spine up to `<body>`, as every parent also includes that #id element. Instead, emit a child-combinator path from the id's depth — `:has(> #id)` for a direct child, `:has(> * > #id)` for a grandchild — isolating the single element that parents the id. The search is capped at two levels deep, so a coincidental deep id is ignored rather than anchored with a fragile long path.
