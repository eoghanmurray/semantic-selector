# A semantic selector (not a unique one)

This project aims to generate a semantic or 'meaningful' CSS selector for a DOM element. We prefer to use class names, ids, and certain attributes over DOM position / structure to give a greater chance that the selector will still point to the same element(s) even if the DOM content is shifted around and the surrounding page has been updated over time. To this end, the library detects and demote common framework-generated and presentational classes which are assumed to be more often swapped in and out to change the appearance or position of an element.

It does **not** guarantee that it will generate a _unique_ selector across all the elements on the page.

## Selector Uniqueness: on-page vs. between page versions

Selector uniqueness is often achieved in other libraries with positional ordinals (`:nth-of-type`, `:nth-child`) and/or over specification of DOM structure (`div > span > div`) This library deliberately avoids that, and instead, separately to the selector, outputs the position of the selected element on the page, along with the total number of matched elements. So instead of injecting a local '_nth_'' position into a non-deterministic part of the selector (which is brittle), it focuses on generating a good selector first, along with a global '_nth_'. This position information can be enough to re-locate the 'same' element at a later point in time, although depending on the use-case supplementary information such as record-time element dimensions can add disambiguation firepower.

The library satisfied itself that in pathalogical cases, multiple elements can have little meaningful difference between them e.g. an author duplicates an identical 'Buy Now' button on every section on the page; the meaningful thing we want to capture is:

- that it is a buy button with the following significant ancestry (the selector)

- that it's the 2nd such button on the page

Other libraries which would have stopped their search (if there were only one button on the page) have to continue iterating, adding incidental noise to fabricate a distinction in order to satisfy the uniqueness constraint.

## Install

```sh
npm install semantic-selector
```

## Usage

```ts
import { semanticSelector } from 'semantic-selector';

const el = document.querySelector('.buy-button')!;
semanticSelector(el); // relative to document.body (default)
semanticSelector(el, someRoot); // relative to a given root
```

```
semanticSelector(el: Element, root: Element = document.body): string
```

Browser (UMD global `semanticSelector`):

```html
<script src="https://unpkg.com/semantic-selector"></script>
<script>
  semanticSelector(document.querySelector('#target'));
</script>
```

## How it ranks identity

Per element, best → worst:

1. a strong own **id** (stops the walk)
2. **url** — `href` / `src`, with volatile query/hash stripping
3. a form control's **name** — the backend submission key
4. **class** and **ARIA**, interleaved by quality:
   `tier-A class > aria-label > tier-B class > role > tier-C class > rel`
5. a stable id in the element's subtree — `:has(#id)`
6. a stable id on the immediately preceding sibling — `#prev + tag`

**Class quality tiers:** A = semantic/component (`entry-content`, `product-card`),
B = framework-namespaced (`wp-…`, `elementor…`, `Mui…`), C = utility/atomic
(Bootstrap grid, spacing helpers). The best-tier class is chosen (not the first
in DOM order), and a low-quality class loses to an explicit `aria-label`.

**Structural noise is dropped.** Only the clicked element keeps its tag; ancestor
tags are stripped (`#nav a[href="/x"]`, not `nav#nav > ul > li > a…`). Ancestors
with no identity are omitted entirely, and a **redundant** low-quality class
ancestor (one whose removal doesn't grow the match set) is pruned — so semantic
context and strong-id anchors survive, framework wrappers don't.

**Generated values are rejected** for both ids and classes: ember, React
`useId`, Radix, MUI, Headless UI, Angular Material/CDK, uuid/hex hashes,
styled-components, emotion, CSS-module hashes, state classes, and over-long
identifiers.

## Comparison

[`finder`](https://github.com/antonmedv/finder) is the best-in-class jumping off point for this library; it has as it's main goals _uniqueness_ and _brevity_, both important, but not what we're aiming for here.

[`stable-selector`](https://github.com/qaz1230sp/stable-selector) addresses the same problem but is still strongly weighted towards finding a unique selector in the _current_ document, whereas `semantic-selector` aims to produce a selector which will still point to the same element in future versions of the document.
`semantic-selector` deliberately avoids **structure** and **position**.

|                             | **semantic-selector**                                              | **finder** (antonmedv)                  | **stable-selector** (qaz1230sp)                                                         |
| --------------------------- | ------------------------------------------------------------------ | --------------------------------------- | --------------------------------------------------------------------------------------- |
| Goal                        | Semantic, long term 'identity' of an element between page versions | Shortest **unique** selector            | **Unique**, stable selector                                                             |
| Selection                   | Fixed-priority ladder                                              | Penalty **search** for shortest unique  | 4-dimension weighted **scoring** (uniqueness 0.4, stability 0.35, brevity, readability) |
| Selector on-page uniqueness | **Not required** → caller always receives matchIndex + match count | Required — keeps searching              | Required — scored down; structural fallback forces it                                   |
| Positional ordinals         | never in selector itself (see matchIndex)                          | `:nth-child` when needed                | `:nth-of-type` when needed                                                              |
| Combinators                 | Descendant                                                         | Descendant                              | Direct child `>`                                                                        |
| Ancestor structure          | Identity-only; tags stripped; redundant low-quality pruned         | Minimal unique path                     | Path up to `maxDepth`, `nth`-enriched                                                   |
| Value filtering             | Reject-lists for known frameworks                                  | `wordLike` (rejects digits/short names) | 3 layers: built-in patterns + **Shannon-entropy heuristic** + user blacklist            |
| Class quality               | **A/B/C semantic tiers**, best chosen                              | first N matching classes                | stable classes (up to 3), no semantic tier                                              |
| Output                      | CSS                                                                | CSS                                     | **CSS + XPath + Playwright**                                                            |
| Config                      | `(el, root)` only                                                  | predicates + threshold                  | extensive (`configure()`, priorities, blacklist, formats, maxDepth)                     |

The trade-off is about **when** the selector is used:

- **finder / stable-selector** optimise for a _unique locator against the DOM in
  front of you now_ (scraping, a Playwright test run). Uniqueness is paramount, and
  `nth` is fine because the DOM won't move under you mid-session.
- **semantic-selector** optimises for _drift between capture and retrieval_. Because
  out-of-band `matchIndex` can resolve ambiguity, we can let go of the uniqueness requirement and produce a more _semantic_ selector that has a higher likelihood of surviving long term page restructuring or even a swap out of the framework used to produce the page.

## License

MIT © Eoghan Murray
