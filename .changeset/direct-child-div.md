---
"semantic-selector": patch
---

When we've got a descendant selector that targets a div, which could potentially extend to lots of other divs, make sure that we anchor it to it's immediate parent using a direct-child combinator. Do not apply this rule to other non-container-like tags such as <i> etc. which normally don't nest; allow an insertion of a new intermediary container to not upset the selector (e.g. `#abc > i` would break if the dom became `#abc > div > i`
