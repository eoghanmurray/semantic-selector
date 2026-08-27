---
"semantic-selector": minor
---

Add a component-boundary class tier (S) and demote presentational classes to utility.

Two changes to class ranking, both aimed at the same real-world failure: an identity-less leaf inside a repeating card/list produced a near-useless selector because the meaningful container was dropped and the leaf itself claimed a high rank.

1. **New tier S for component-boundary names** — a class naming a repeating unit (`card`, `item`, `product`, `tile`, `article`, `teaser`, `listing`, `thumbnail`, matched as a whole word) now outranks a plain tier-A semantic class. In the ancestor ratchet this keeps the block boundary (`.product-card`, `.menu-item`) above a generic inner wrapper (`.values`, `.content`), and on a single element a component class is chosen over a plain semantic one. Utility and framework classes are ranked first, so a framework class that merely contains a component word (`has-background-card-two`, `wp-block-navigation-item`) is not promoted.

2. **Presentational classes demoted to tier C (utility)** — size words (`small`, `large`, `medium`, `big`, `tiny`, `mini`, `huge`), position/alignment words (`left`, `right`, `center`, `top`, `bottom`, `middle`), Bulma grid (`column`, `columns`), generic wrappers (`wrap`, `wrapper`, `inner`, `outer`), and the `clearfix` / `needsclick` markers are no longer treated as semantic identity. A `p.small` leaf no longer blocks a semantic ancestor from being kept.
