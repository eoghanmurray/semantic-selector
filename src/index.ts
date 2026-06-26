/**
 * stable-selector — generate a *stable*, identity-only CSS selector for a DOM
 * element.
 *
 * Unlike a uniqueness-seeking generator (finder, Robula+), the result is NOT
 * guaranteed to match exactly one element: several same-identity elements
 * (e.g. a grid of `a[href="/buy"]`) collapse to the same selector by design.
 * Consumers resolve residual ambiguity out-of-band (a match index plus
 * geometry) rather than baking brittle positional ordinals into the string,
 * which keeps the selector resilient to DOM reordering.
 *
 * See docs/prior-art.md for how this compares to Robula+, PostHog and finder.
 */

// --- CSS identifier / string escaping ---

const regexSingleEscape = /[ -,\.\/:-@\[\]\^`\{-~]/;

function cssEsc(str: string, isIdent: boolean): string {
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str.charAt(i);
    const cp = ch.charCodeAt(0);
    if (cp < 0x20 || cp > 0x7e) {
      out += '\\' + cp.toString(16).toUpperCase() + ' ';
    } else if (
      isIdent
        ? regexSingleEscape.test(ch)
        : ch === '"' || ch === "'" || ch === '\\'
    ) {
      out += '\\' + ch;
    } else {
      out += ch;
    }
  }
  if (isIdent && /^-[-\d]/.test(out)) {
    out = '\\-' + out.slice(1);
  } else if (isIdent && /^\d/.test(out)) {
    out = '\\3' + out.charAt(0) + ' ' + out.slice(1);
  }
  return out;
}

/** Reject framework-generated IDs (ember, yui, React useId, etc.) */
function isStableId(id: string): boolean {
  if (/^ember\d+$/.test(id)) return false;
  if (/^yui/.test(id)) return false;
  // React useId / Radix / MUI v5+ / Headless UI all emit colon-wrapped ids
  // like ":r0:", ":R2m:", or use one as a prefix (":r0:-label"). They are
  // regenerated on every render, so are unsuitable for our use.
  if (/^:r[a-z0-9]*:/i.test(id)) return false;
  if (/^mui-\d+$/.test(id)) return false; // MUI legacy auto ids
  if (/^headlessui-/.test(id)) return false; // Headless UI
  if (/^radix-/.test(id)) return false; // Radix UI
  // Angular Material / CDK — sequential per page load (mat-input-3,
  // cdk-overlay-2); the trailing digit makes them ephemeral.
  if (/^(mat|cdk)-[a-z-]+\d+$/.test(id)) return false;
  // UUIDs / content hashes: an 8+ char hex run that contains a hex *letter*.
  // A pure digit run (no a–f) is deliberately left to stand — purely numeric
  // ids are usually stable DB row ids, and idSelector() emits them as
  // [id="..."], which relocates the element more reliably than the
  // nth-of-type structural fallback.
  const hexRun = id.match(/[0-9a-f]{8,}/i);
  if (hexRun && /[a-f]/i.test(hexRun[0])) return false;
  return true;
}

/**
 * A "weak" stable id: a word stem, a separator, then a trailing number, e.g.
 * `block-12`, `item-3`, `wpforms-field_5`. These come from page builders/CMSes
 * that enumerate blocks per page, so the number is reassigned when the page is
 * re-edited — usable as a *hint* but not as a globally-unique handle. The walk
 * must NOT stop on one, and we only fold it into the selector when the weaker
 * (weak-id-free) selector is otherwise ambiguous. Deliberately narrow (requires
 * a separator before the digits, so content ids like `heading2` stay strong);
 * the category is meant to grow.
 */
function isWeakId(id: string): boolean {
  return /^[a-z][a-z-]*[-_]\d+$/i.test(id);
}

/**
 * A *strong* id: stable AND not weak. Only strong ids may serve as a unique
 * anchor (own-id stop, `:has(#id)` descendant, `prev#id + tag` sibling); a weak
 * id is no better as someone else's anchor than as the element's own handle.
 */
function isStrongId(id: string): boolean {
  return isStableId(id) && !isWeakId(id);
}

/**
 * Max length for an identifier we are willing to bake into a selector (class
 * name, attribute value). Anything longer is almost certainly machine-generated
 * (hashed utility class, serialized state) and unsuited to our goals.
 */
const MAX_IDENT_LEN = 64;

/** Reject framework-generated class names */
function isStableClass(cn: string): boolean {
  if (cn.length > MAX_IDENT_LEN) return false; // generated / serialized
  if (cn.startsWith('styled__') || cn.startsWith('sc-') || cn.includes('__sc-'))
    return false;
  if (/^css-/.test(cn)) return false; // emotion
  if (/^_[a-zA-Z0-9]{5,}$/.test(cn)) return false; // CSS modules hash
  if (
    /active|hover|focus|selected|open|closed|visible|hidden|disabled/i.test(cn)
  )
    return false; // state classes
  if (/\d{4,}/.test(cn)) return false; // contains long numeric sequences
  return true;
}

/**
 * Build an id-based selector fragment. IDs that start with a digit can't be
 * written as `#id` without an ugly numeric escape (`#\33 col`); an
 * `[id="..."]` attribute selector is valid and more readable.
 * (finder PR: https://github.com/antonmedv/finder/pull/69)
 */
function idSelector(id: string): string {
  if (/^\d/.test(id)) {
    return '[id="' + cssEsc(id, false) + '"]';
  }
  return '#' + cssEsc(id, true);
}

// --- Anchor matching (finder PR: https://github.com/antonmedv/finder/pull/74) ---
//
// For certain use cases like 'what was clicked on', the target href of an anchor
// embodies the identity of the button/link.  Reapplying against an updated page
// has the advantage of implicitly verifying that  the href/src still matches

/** Tag → the attribute that holds its URL. */
const URL_ATTR: Record<string, string> = {
  a: 'href',
  area: 'href',
  img: 'src',
};

/** Known ad/analytics click-id and campaign params — always volatile. */
const TRACKING_PARAM =
  /^(utm_|fbclid$|gclid$|gclsrc$|dclid$|gbraid$|wbraid$|msclkid$|yclid$|mc_eid$|mc_cid$|igshid$|_ga$|_gl$|ref_src$|spm$|s_kwcid$|twclid$|ttclid$)/i;

function urlAttr(el: Element): { attr: string; raw: string } | null {
  const attr = URL_ATTR[el.tagName.toLowerCase()];
  if (!attr) return null;
  const raw = el.getAttribute(attr);
  if (!raw || raw.startsWith('data:') || raw.length > 512) return null;
  return { attr, raw };
}

/** A single query value that looks like a random token (fbclid, session hash…). */
function looksRandomHash(v: string): boolean {
  if (v.length < 8) return false;
  if (!/^[A-Za-z0-9]+$/.test(v)) return false; // contiguous alnum, no word separators
  return /\d/.test(v) && /[A-Za-z]/.test(v); // mixed digits + letters → high entropy
}

/**
 * Decide whether to lop off a URL's query/hash and match by prefix.
 * Strip when the query is volatile:
 *  - multiple params (cache-busters, utm bundles), or
 *  - a single param that is a known tracking key or a random-looking hash.
 * Keep (exact match) when a single param looks meaningful
 * (`?article=a-particular-article`) or there's only a hash anchor
 * (`#third-section`) — those distinguish real destinations.
 */
function preferStrip(raw: string): boolean {
  const qi = raw.indexOf('?');
  if (qi < 0) return false; // only a path, or a hash anchor — keep it
  let query = raw.slice(qi + 1);
  const hi = query.indexOf('#');
  if (hi >= 0) query = query.slice(0, hi);
  const params = query.split('&').filter(Boolean);
  if (params.length === 0) return false;
  if (params.length > 1) return true;
  const eq = params[0].indexOf('=');
  const key = eq < 0 ? params[0] : params[0].slice(0, eq);
  const val = eq < 0 ? '' : params[0].slice(eq + 1);
  return TRACKING_PARAM.test(key) || looksRandomHash(val);
}

function urlBase(raw: string): string {
  return raw.replace(/[?#].*$/, '');
}

/**
 * The url-matching segment for an element, or null if it has no usable url.
 * A volatile query collapses to a stripped prefix match; anything stable
 * (significant query, hash anchor, or no query at all) is matched exactly.
 * We deliberately never re-embed a volatile token (e.g. a per-visit
 * `?fbclid=…`) — the recorded selector would never reoccur.
 */
function urlSegment(el: Element): string | null {
  const info = urlAttr(el);
  if (!info) return null;
  const tag = el.tagName.toLowerCase();
  if (preferStrip(info.raw)) {
    return (
      tag + '[' + info.attr + '^="' + cssEsc(urlBase(info.raw), false) + '"]'
    );
  }
  return tag + '[' + info.attr + '="' + cssEsc(info.raw, false) + '"]';
}

// --- Attribute matching (finder uses role/name/aria-label/rel/href) ---
//
// We match intrinsic attributes as `tag[attr="value"]`. `href` is intentionally
// absent — the url tier handles it better (query-stripping). `name` is split
// out from the rest: on form controls it is the *backend submission key*, so it
// barely changes across redesigns (which routinely rewrite styling classes),
// and therefore ranks ABOVE class. The remaining semantic attributes are weaker
// and rank below class: `aria-label` is localized (differs across translated
// copies of the same logical page) and `role` is coarse (shared by many
// elements).

/** Tags where `name` is the HTML-standard control identity (form submission key). */
const NAME_AS_CONTROL = new Set([
  'input',
  'select',
  'textarea',
  'button',
  'form',
  'fieldset',
  'output',
]);

/** Weaker semantic attributes, ranked below class. */
const SEMANTIC_ATTRS = ['aria-label', 'role', 'rel'];

/** Reject empty / over-long / auto-generated-looking attribute values. */
function isStableAttrValue(v: string): boolean {
  if (!v || v.length > MAX_IDENT_LEN) return false;
  if (/\d{4,}/.test(v)) return false; // long digit runs ⇒ generated
  if (looksRandomHash(v)) return false;
  return true;
}

/**
 * The control-`name` segment (`tag[name="…"]`), or null. Restricted to form
 * controls, where `name` is server-coupled and highly durable; on other tags a
 * `name` attribute is non-standard and not treated as a high-tier anchor.
 */
function nameSegment(el: Element): string | null {
  const tag = el.tagName.toLowerCase();
  if (!NAME_AS_CONTROL.has(tag)) return null;
  const v = el.getAttribute('name');
  if (v && isStableAttrValue(v)) {
    return tag + '[name="' + cssEsc(v, false) + '"]';
  }
  return null;
}

/** The first stable semantic-attribute segment (aria-label/role/rel), or null. */
function attrSegment(el: Element): string | null {
  const tag = el.tagName.toLowerCase();
  for (const name of SEMANTIC_ATTRS) {
    const v = el.getAttribute(name);
    if (v && isStableAttrValue(v)) {
      return tag + '[' + name + '="' + cssEsc(v, false) + '"]';
    }
  }
  return null;
}

/**
 * Find the nearest stable id inside an element's subtree (breadth-first, so we
 * prefer the shallowest match). Used to anchor an otherwise-structural ancestor
 * via `tag:has(#id)`: because the id lives *within* the element's subtree it
 * moves together with it, which is more robust than an nth-of-type ordinal.
 * Bounded so it stays cheap on large subtrees.
 */
function findStableDescendantId(el: Element): string | null {
  const queue: Element[] = [];
  for (let i = 0; i < el.children.length; i++) queue.push(el.children[i]);
  let scanned = 0;
  for (let head = 0; head < queue.length; head++) {
    const node = queue[head];
    if (++scanned > 200) break;
    if (node.id && isStrongId(node.id)) return node.id;
    for (let i = 0; i < node.children.length; i++) queue.push(node.children[i]);
  }
  return null;
}

/**
 * The non-id identity segment for one element, or null. This is everything in
 * the priority order BELOW a strong own id, so it doubles as the base identity
 * a weak-id element falls back on:
 *  - url (href/src)
 *  - a form control's `name` (the backend submission key — more durable than
 *    styling classes, which redesigns rewrite)
 *  - stable class
 *  - a weaker semantic attribute (`aria-label`/`role`/`rel`)
 *  - a stable id within its subtree (`tag:has(#id)`) — the id moves *with* the
 *    element, so it's the more robust of the two id-anchored rescues
 *  - a stable id on its immediate preceding sibling (`prev#id + tag`) — e.g. a
 *    heading pinning the paragraph after it (`h1#intro + p`). The anchor is a
 *    *separate* adjacent element, so it's more fragile (an inserted node between
 *    them breaks `+`); hence it sits last. But there's no "which id?" ambiguity:
 *    there is exactly one immediate preceding sibling.
 */
function nonIdSegment(
  el: Element,
): { seg: string; stop?: boolean; stopId?: string } | null {
  const tag = el.tagName.toLowerCase();

  const url = urlSegment(el);
  if (url) return { seg: url };

  const nameSeg = nameSegment(el);
  if (nameSeg) return { seg: nameSeg };

  if (el.classList) {
    for (const cn of Array.from(el.classList)) {
      if (isStableClass(cn)) return { seg: tag + '.' + cssEsc(cn, true) };
    }
  }

  const attrSeg = attrSegment(el);
  if (attrSeg) return { seg: attrSeg };

  const descId = findStableDescendantId(el);
  if (descId) return { seg: tag + ':has(' + idSelector(descId) + ')' };

  const prev = el.previousElementSibling;
  if (prev && prev.id && isStrongId(prev.id)) {
    // The id sits directly on the matched sibling (`h1#intro`), so it's a
    // globally-unique handle — the `+ tag` then pins exactly one element.
    // Already unique: stop, like own-id. (Unlike `:has(#id)` above, where the
    // id is a descendant and several nested ancestors could match it.) `stopId`
    // exposes that id so the duplicate-id rescue can climb past it if the same
    // id turns out to be repeated in malformed markup.
    return {
      seg: prev.tagName.toLowerCase() + idSelector(prev.id) + ' + ' + tag,
      stop: true,
      stopId: prev.id,
    };
  }

  return null;
}

/**
 * The identity segment for one element, or null if it carries no identity.
 *
 * Priority: (1) a strong own id [stops the walk], then everything in
 * `nonIdSegment` (url > name > class > semantic attr > `:has(#id)` >
 * `prev#id + tag`). A purely structural element (none of these) returns null
 * and is dropped from the path.
 *
 * A *weak*, CMS-enumerated id (`block-12`, see isWeakId) is NOT a unique handle,
 * so it never replaces the element's real identity and never stops the walk.
 * Instead `seg` carries the element's non-id identity (or null) and `weakSeg`
 * carries that same identity *augmented* with the weak id (`div.block#block-12`,
 * or `div#block-12` when there's nothing else). stableSelector uses `weakSeg`
 * only when the weak-id-free selector turns out ambiguous.
 */
function stableSegment(el: Element): {
  seg: string | null;
  stop?: boolean;
  stopId?: string;
  weakSeg?: string;
} | null {
  const tag = el.tagName.toLowerCase();

  if (el.id && isStrongId(el.id)) {
    return { seg: tag + idSelector(el.id), stop: true, stopId: el.id };
  }

  const rest = nonIdSegment(el);

  if (el.id && isStableId(el.id) && isWeakId(el.id)) {
    return {
      seg: rest ? rest.seg : null,
      stop: rest?.stop,
      stopId: rest?.stopId,
      weakSeg: (rest ? rest.seg : tag) + idSelector(el.id),
    };
  }

  return rest;
}

/**
 * Does this id resolve to more than one element in root? A strong id is
 * normally treated as a unique handle that stops the ancestor walk, but
 * malformed pages in the wild do repeat an id (e.g. two nested
 * `#content-wrapper`). When that happens we must NOT stop on it, or the
 * selector silently collapses onto several elements.
 */
function ambiguousId(id: string, root: Element): boolean {
  try {
    return root.querySelectorAll(idSelector(id)).length > 1;
  } catch {
    return false;
  }
}

/**
 * Walk an element's ancestor path and join its identity segments with
 * descendant combinators. Purely structural ancestors (no id/url/class/`:has`
 * anchor) are omitted — we never emit positional `nth-of-type` ordinals.
 *
 * When `includeWeak` is false a weak (CMS-enumerated) id is treated as no
 * identity at all: dropped if it's an interior ancestor, replaced by a bare tag
 * if it's the terminal element. When true the weak id is emitted as a segment.
 * Either way a weak id never stops the walk (only a strong own-id / sibling-id
 * anchor does).
 *
 * When `dedupeIds` is set, an id-anchored stop (own id, or a preceding-sibling
 * `prev#id + tag` anchor) is honoured only if that id is actually unique in
 * root; a duplicated anchor id keeps its segment but does NOT stop the walk, so
 * an ancestor segment can single the element out.
 */
function buildSelectorPath(
  el: Element,
  root: Element,
  includeWeak: boolean,
  dedupeIds: boolean,
): string {
  const segments: string[] = [];
  let current: Element | null = el;
  let isTerminal = true;

  while (current && current !== root && current !== document.documentElement) {
    const seg = stableSegment(current);
    const chosen = seg
      ? includeWeak && seg.weakSeg
        ? seg.weakSeg
        : seg.seg
      : null;
    if (chosen) {
      segments.push(chosen);
      if (seg && seg.stop) {
        // A stop assumes its anchoring id (`seg.stopId`) is a unique handle —
        // either the element's own id or a strong id on its immediate preceding
        // sibling (`prev#id + tag`). When dedupeIds is set and that id is
        // duplicated in root (malformed markup), keep the segment but climb on
        // so an ancestor disambiguates.
        const ambiguousStop =
          dedupeIds && !!seg.stopId && ambiguousId(seg.stopId, root);
        if (!ambiguousStop) break;
      }
    } else if (isTerminal) {
      // The clicked element itself has no usable identity — keep a bare tag so
      // the selector still resolves to it (refined by match index + geometry).
      segments.push(current.tagName.toLowerCase());
    }
    current = current.parentElement;
    isTerminal = false;
  }

  return segments.reverse().join(' ');
}

/**
 * Build a *stable* CSS selector for an element: the concatenation of the
 * intrinsic, identity-bearing parts of its ancestor path, joined by descendant
 * combinators.
 *
 * The result is NOT guaranteed to be unique: several "same-identity" elements
 * (e.g. a grid of `a[href="/buy"]`) collapse to the same selector by design.
 * The caller resolves that residual ambiguity with a global `selectorMatchIndex`
 * plus geometry, rather than baking brittle position into the string.
 *
 * Weak (CMS-enumerated) ids like `block-12` get renumbered when a page is
 * re-edited, so we prefer the weak-id-free selector and only fold the weak ids
 * back in when that selector is otherwise ambiguous against `root` (where they
 * actually help narrow it down). The terminal element always contributes a
 * segment (its identity, or a bare tag) so the selector resolves to it.
 */
export function stableSelector(
  el: Element,
  root: Element = document.body,
): string {
  if (el === root) return el.tagName.toLowerCase();
  if (!el.tagName) return ''; // e.g. document node

  const base = buildSelectorPath(el, root, false, false);
  const strong = buildSelectorPath(el, root, true, false);

  // Prefer the weak-id-free selector; only lean on the renumber-prone weak ids
  // when the page genuinely needs them to single the element out.
  let chosen = base;
  if (strong !== base) {
    try {
      if (root.querySelectorAll(base).length > 1) chosen = strong;
    } catch {
      // base not resolvable in this engine (e.g. a `:has()` gap) — use strong.
      chosen = strong;
    }
  }

  // Duplicate-id rescue: a strong own id is treated as a unique handle that
  // stops the ancestor walk, but malformed pages in the wild ship the same id
  // twice (e.g. nested `#content-wrapper`). If the chosen selector still
  // matches several elements, re-walk *past* any duplicated own-id (keeping the
  // id segment, but climbing on for a disambiguating ancestor) and adopt the
  // result only when it singles the element out more tightly.
  try {
    const n = root.querySelectorAll(chosen).length;
    if (n > 1) {
      const deduped = buildSelectorPath(el, root, chosen === strong, true);
      if (deduped !== chosen && root.querySelectorAll(deduped).length < n) {
        chosen = deduped;
      }
    }
  } catch {
    // chosen not resolvable in this engine — leave it as-is.
  }

  return chosen;
}
