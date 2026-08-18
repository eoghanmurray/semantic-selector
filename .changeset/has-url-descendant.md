---
"semantic-selector": patch
---

Improve e.g. bare <p> targets by identifying the paragraph using anchor href's that it contains e.g. `p:has(> a[href="/buy"])`. This generalises the existing `:has(> #id)`
