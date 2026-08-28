# A semantic selector (not a unique one)

This project aims to generate a semantic or 'meaningful' CSS selector for a DOM element. We prefer to use good class names, ids, and certain attributes over DOM position / structure to give a greater chance that the selector will still point to the same element(s) even if the DOM content is shifted around and the surrounding page has been updated over time. The library is picky and detects and demotes common framework-generated and presentational classes which are assumed to be more often swapped in and out to change the appearance or position of an element.

It does **not** guarantee that it will generate a _unique_ selector across all the elements on the page.

## Selector Uniqueness: on-page vs. between page versions

Selector uniqueness is often achieved in other libraries with positional ordinals (`:nth-of-type`, `:nth-child`) and/or over specification of DOM structure (`div > span > div`).     This library deliberately avoids that, and instead focuses only on generating a good selector. The uniqueness constraint means that the choice of selector is dictated by other elements which may only be present in the current version of the page. Other libraries have to continue iterating, adding incidental noise to fabricate a distinction in order to satisfy the uniqueness constraint.

Instead we let the calling code decide on how to distinguish between multiple elements if required, e.g. by also recording element dimensions, or by recording that the target element is the 2nd on the page (a global 'nth' positional in terms of `document.querySelectorAll` instead of a brittle local 'nth' somewhere in the selector).

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

#### Browser (UMD global `semanticSelector`):

```html
<script src="https://unpkg.com/semantic-selector"></script>
<script>
  semanticSelector(document.querySelector('#target'));
</script>
```

### What you get back

`semanticSelector` returns a **plain string** — the selector.
Given the following markup (two identical buy buttons):

```html
<main>
  <section class="wp-block-group product-card">
    <a class="wp-block-button__link buy-button"
       href="/checkout?utm_source=x"
      >Quick Buy</a
    >
  </section>
  <section class="wp-block-group product-card">
    <a class="wp-block-button__link buy-button"
       href="/checkout?utm_source=y&m=a"
      >Add to Cart</a
    >
  </section>
</main>
```

```ts
const targetIsSecondButton = document.querySelectorAll('.buy-button')[1];
const selector = semanticSelector(targetIsSecondButton);
// → '.product-card a[href^="/checkout"]'
```

Note what happened: the framework classes (`wp-block-group`,
`wp-block-button__link`) and the volatile `?utm_source=…` query were dropped, along witht he `m=a` key differentiator in the link.  The
semantic `.product-card` ancestor was kept.  The end result is that we don't have enough class / dom based signals in this example to differentiate them so the result deliberately matches **both** (no`:nth-of-type` inserted to force uniqueness).

Since the selector is not guaranteed unique (we don't look at length of `document.querySelectorAll` during selector generation), if further refinement to a single element is a requirement, it's up to the caller to resolve this separately.
ambiguity out-of-band by pairing it with a match index + count (see [Selector
Uniqueness](#selector-uniqueness-on-page-vs-between-page-versions)):

```ts
// maybe we want re-run the output against page to count other matches
const matches = Array.from(document.querySelectorAll(selector));
// or maybe text content is important as a differentiator
const innerText = el.innerText.substring(0, 40);
// or maybe element dimensions
const clientRect = el.getBoundingClientRect();

const result = {
  selector, // '.product-card a[href^="/checkout"]'
  matchCount: matches.length, // 2
  matchIndex: matches.indexOf(el), // 1  (0-based so the second one of two)
  innerText,  // "Add to Cart"
  clientRect, // DOMRect { x: 110, y: 413.95, width: 313, height: ...
};
```

To relocate the element against a later version of the page, re-run the selector against the new page and take some combination of the above (and/or other signals) to decide whether the element match continues to be valid or not.

## How it ranks identity

Per element, best → worst:

1. a stable own **id** (the top rank; a stable id anywhere on the path ends the walk)
2. **url** — `href` / `src`, with volatile query/hash stripping. Note: if the same element contains both an id and a url, we produce a selector that can match based on either for durability across future versions of the page.
3. a form control's **name** — the backend submission key
4. **class** and **ARIA**, interleaved by quality:
   `tier-S component class > tier-A class > aria-label > tier-B class > role > tier-C class > rel`
5. a stable id in the element's subtree — `:has(#id)`
6. a stable id on the immediately preceding sibling — `#prev + tag`

**id and url are considered the same rank** When one element carries both
a stable id and a url, we keep both e.g.  `a:is(#buy-cta, [href="/buy"])` or `:is(#buy-cta, [href="/buy"]) span` rather than
picking one. We either handle alone still finds the element, so it survives the id
*or* the href changing.

**Class quality tiers:** S = component-boundary names for a repeating unit
(`product-card`, `menu-item`, `product-tile`, `article`) — kept above a plain
semantic ancestor so the meaningful block survives; A = other semantic/content
(`entry-content`, `search-filter`); B = framework-namespaced (`wp-…`,
`elementor…`, `Mui…`); C = utility/atomic/presentational (Bootstrap & Bulma grid,
spacing helpers, size/alignment words like `small`, `left`, generic `wrap`).
The best-tier class is chosen (not the first in DOM order), and a low-quality
class loses to an explicit `aria-label`.

**Structural noise is dropped, by a monotone ratchet.** Only the clicked element
keeps its tag; ancestor tags are stripped (`#nav a[href="/x"]`, not
`nav#nav > ul > li > a…`). The _nearest_ identity-bearing ancestor is always kept
as a container anchor — which block the target sits in (the `.wp-block-group`
around one of several `a[href="/buy"]`) — even if it ranks below the target's own
identity. Above that anchor, a further ancestor earns a segment only if its
identity is _strictly better_ than everything already kept, so a stack of
same-tier wrapper classes (`gallery__carousel` in `gallery__wrapper` in
`gallery`) collapses to a single representative, and a stable id ends the walk.
This is computed from the element and its ancestors alone — **no queries against
the wider page** — so the same subtree always yields the same selector, and
residual ambiguity is left to the caller's match index rather than chased with
extra context.

**Generated values are rejected** for both ids and classes: ember, React
`useId`, Radix, MUI, Headless UI, Angular Material/CDK, uuid/hex hashes,
styled-components, emotion, CSS-module hashes, state classes, and over-long
identifiers.

## Comparison

[`finder`](https://github.com/antonmedv/finder) is the best-in-class jumping off point for this library; it has as it's main goals _uniqueness_ and _brevity_, both important, but not what we're aiming for here.

[`stable-selector`](https://github.com/qaz1230sp/stable-selector) addresses the same problem but is still strongly weighted towards finding a unique selector in the _current_ document, whereas `semantic-selector` aims to produce a selector which will still point to the same element in future versions of the document.
`semantic-selector` deliberately avoids **structure** and **position**.

|                             | **semantic-selector**                                                     | **finder** (antonmedv)                  | **stable-selector** (qaz1230sp)                                                         |
| --------------------------- | ------------------------------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------- |
| Goal                        | Semantic, long term 'identity' of an element between page versions        | Shortest **unique** selector            | **Unique**, stable selector                                                             |
| Selection                   | Fixed-priority ladder                                                     | Penalty **search** for shortest unique  | 4-dimension weighted **scoring** (uniqueness 0.4, stability 0.35, brevity, readability) |
| Selector on-page uniqueness | **Not required** → caller computes matchIndex + count out-of-band         | Required — keeps searching              | Required — scored down; structural fallback forces it                                   |
| Positional ordinals         | never in selector itself (see matchIndex)                                 | `:nth-child` when needed                | `:nth-of-type` when needed                                                              |
| Combinators                 | Descendant                                                                | Descendant                              | Direct child `>`                                                                        |
| Ancestor structure          | Identity-only; tags stripped; monotone identity ratchet (no page queries) | Minimal unique path                     | Path up to `maxDepth`, `nth`-enriched                                                   |
| Value filtering             | Reject-lists for known frameworks                                         | `wordLike` (rejects digits/short names) | 3 layers: built-in patterns + **Shannon-entropy heuristic** + user blacklist            |
| Class quality               | **A/B/C semantic tiers**, best chosen                                     | first N matching classes                | stable classes (up to 3), no semantic tier                                              |
| Output                      | CSS                                                                       | CSS                                     | **CSS + XPath + Playwright**                                                            |
| Config                      | `(el, root)` only                                                         | predicates + threshold                  | extensive (`configure()`, priorities, blacklist, formats, maxDepth)                     |

The trade-off is about **when** the selector is used:

- **finder / stable-selector** optimise for a _unique locator against the DOM in
  front of you now_ (scraping, a Playwright test run). Uniqueness is paramount, and
  `nth` is fine because the DOM won't move under you mid-session.
- **semantic-selector** optimises for _drift between capture and retrieval_. Because
  out-of-band `matchIndex` can resolve ambiguity, we can let go of the uniqueness requirement and produce a more _semantic_ selector that has a higher likelihood of surviving long term page restructuring or even a swap out of the framework used to produce the page.

## License

MIT © Eoghan Murray
