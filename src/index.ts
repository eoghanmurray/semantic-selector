/**
 * semantic-selector — generate a *semantic*, identity-only CSS selector for a
 * DOM element: it ranks each ancestor by how meaningful its identity is
 * (id > url > control name > semantic class > ARIA), never by position.
 *
 * Unlike a uniqueness-seeking generator (finder, Robula+, qaz1230sp's
 * stable-selector), the result is NOT guaranteed to match exactly one element:
 * several same-identity elements (e.g. a grid of `a[href="/buy"]`) collapse to
 * the same selector by design. Consumers resolve residual ambiguity out-of-band
 * (a match index plus geometry) rather than baking brittle positional ordinals
 * (`:nth-of-type`) into the string, which keeps the selector resilient to DOM
 * reordering and restyling between long term versions of the page.
 *
 * See README.md / docs/prior-art.md for how this compares to finder, Robula+,
 * PostHog and stable-selector.
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

/**
 * Does the string contain a maximal alphanumeric run that looks like a random
 * machine token (ULID, nanoid, base32/62 hash)? The tell is *interleaved*
 * letter and digit runs: a hand-authored id is at most a word plus a number
 * (`heading2`, `section3` → ≤2 runs), whereas a random token alternates many
 * times (`016JB91MZ80000000000036PNV` → 6 runs). We require a long run with ≥4
 * such runs so a word-plus-number id stays strong. A pure-digit run (DB id) and
 * a pure-letter run (a real word) are never flagged — a random token mixes both.
 */
function hasRandomTokenRun(s: string): boolean {
  for (const seg of s.split(/[^A-Za-z0-9]+/)) {
    if (seg.length < 10) continue;
    if (!/[A-Za-z]/.test(seg) || !/\d/.test(seg)) continue; // need both
    const runs = seg.match(/[A-Za-z]+|\d+/g);
    if (runs && runs.length >= 4) return true;
  }
  return false;
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
  if (hasRandomTokenRun(id)) return false;
  return true;
}

/**
 * A "weak" stable id: a word stem ending in a separator and a trailing number,
 * e.g. `block-12`, `item-3`, `wpforms-field_5`, `s3_1_offset_2`. Page
 * builders/CMSes enumerate blocks/sections/gradient-stops per page, so the
 * number is reassigned when the page is re-edited — a *hint*, not a
 * globally-unique handle. The walk must NOT stop on one; we only fold it into
 * the selector when the weak-id-free selector is otherwise ambiguous.
 *
 * The separator right before the digits is required, so content ids like
 * `heading2` stay strong; digits earlier in the stem don't matter.
 */
function isWeakId(id: string): boolean {
  return /^[a-z][\w-]*[-_]\d+$/i.test(id);
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

/**
 * A short trailing segment that looks like a build-tool hash rather than a real
 * word — the base62 token CSS-Modules / styled-system / webpack css-loader
 * append to a scoped name (`…-Zu3Ce`, `…-CNBnY`). The tells are a mixed-case /
 * interleaved digit+letter run, or vowelless irregular-case gibberish. Plain
 * words — lowercase (`content`), Capitalized (`Wrapper`), camelCase (`navBar`),
 * word+number (`col3`) — are NOT hashes, so their class survives intact.
 */
function looksLikeHash(s: string): boolean {
  const mixedCase = /[a-z]/.test(s) && /[A-Z]/.test(s);
  if (/\d/.test(s) && /[A-Za-z]/.test(s)) {
    if (mixedCase) return true; // Zu3Ce
    return s.match(/[A-Za-z]+|\d+/g)!.length >= 3; // a1b2c3 interleaved, not col3
  }
  if (/^[a-z]+$/.test(s)) return false; // lowercase word
  if (/^[A-Z][a-z]*$/.test(s)) return false; // Capitalized word (Wrapper)
  if (/[aeiou]/i.test(s)) return false; // vowels ⇒ likely a camelCase word
  return true; // mixed-case & vowelless ⇒ hash (CNBnY)
}

/**
 * If a class is a CSS-Modules / build-tool scoped name of the form
 * `<stem>-<hash>` (`Card-cardContent-Zu3Ce`,
 * `routing-routeTransitionContainer-CNBnY`), return its stable stem
 * (`Card-cardContent`) — the per-build hash suffix changes every deploy, but the
 * stem is authored and durable. Only the trailing hash-looking segment is
 * stripped, so the stem keeps all its real words. Used two ways: `isStableClass`
 * rejects the whole hashed class (never a `.class` anchor), and `nonIdSegment`
 * folds the stem into a last-resort `[class*="stem"]` match.
 */
function moduleClassStem(cn: string): string | null {
  const m = cn.match(/^(.+[A-Za-z0-9])[-_]([A-Za-z0-9]{4,8})$/);
  if (!m) return null;
  const [, stem, hash] = m;
  if (stem.length < 3 || !looksLikeHash(hash)) return null;
  return stem;
}

/**
 * Interaction / transient *state* classes: toggled on by JS or `:` pseudo-mirror
 * in response to the current interaction (click, hover, focus, drag, open/close,
 * play/pause, in-view) rather than describing what the element permanently *is*.
 * They come and go between the moment a selector is recorded and when it is
 * replayed, so they must never anchor a selector. Worse, a class like
 * `plyr__tab-focus` is present *because* the element was just clicked/focused —
 * recording it would pin the selector on the very act of recording it.
 *
 * A conservative, extend-as-needed set. A few entries are mild collision risks
 * with content words (`open` ~ `opening-hours`, `current` ~ `current-affairs`,
 * `loading` ~ `loading-spinner`); they earn their place because the state usage
 * is far more common, and a false demotion is low-harm (it only matters when a
 * better class is also present). Matched per token (see hasStateWord), so words
 * that merely *contain* a state word — `opengraph`, `focusable`, `disclosure`,
 * `preselection` — are kept.
 */
const STATE_WORDS = new Set([
  'active',
  'inactive',
  'hover',
  'hovered',
  'hovering',
  'focus',
  'focused',
  'selected',
  'unselected',
  'deselected',
  'checked',
  'unchecked',
  'indeterminate',
  'pressed',
  'current',
  'highlighted',
  'activated',
  'toggled',
  'open',
  'opened',
  'opening',
  'closed',
  'closing',
  'expanded',
  'collapsed',
  'shown',
  'showing',
  'hiding',
  'hidden',
  'visible',
  'invisible',
  'disabled',
  'loading',
  'busy',
  'dragging',
  'dragover',
  'playing',
  'paused',
  'stuck',
  'entering',
  'leaving',
  'animating',
  'transitioning',
]);

/**
 * Split a class name into its lowercase word tokens, breaking on `-`/`_`
 * separators (BEM `block__element--modifier`, kebab) and camelCase humps
 * (`isOpen` → `is`, `open`). Lets STATE_WORDS match whole words, not substrings.
 */
function classTokens(cn: string): string[] {
  return cn
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .split(/[-_]+/)
    .filter(Boolean)
    .map((t) => t.toLowerCase());
}

/** Does any token of the class name name a transient interaction state? */
function hasStateWord(cn: string): boolean {
  return classTokens(cn).some((t) => STATE_WORDS.has(t));
}

/** Reject framework-generated class names */
function isStableClass(cn: string): boolean {
  if (cn.length > MAX_IDENT_LEN) return false; // generated / serialized
  if (cn.startsWith('styled__') || cn.startsWith('sc-') || cn.includes('__sc-'))
    return false;
  if (/^css-/.test(cn)) return false; // emotion
  if (/^_[a-zA-Z0-9]{5,}$/.test(cn)) return false; // CSS modules hash
  if (moduleClassStem(cn)) return false; // CSS-Modules scoped `stem-HASH`
  if (hasStateWord(cn)) return false; // transient interaction-state class
  if (/\d{4,}/.test(cn)) return false; // contains long numeric sequences
  return true;
}

// --- Class quality tiers ---
//
// isStableClass only rejects machine-generated garbage; it does NOT rank what
// survives. But an element often has several "stable" classes (a WordPress block
// carries `entry-content` alongside `wp-block-post-content`, `has-global-padding`,
// `is-layout-constrained`, `alignfull`, …). Picking the *first in DOM order* is
// luck. These tiers let us pick the best and, later, decide which redundant
// ancestor classes to shed. Two axes matter and they differ here:
//   - stability  — survives a redesign
//   - identity   — describes *this element's* role, and narrows the match set
// A hand-authored component/content name scores high on both; a framework class
// is stable only while the site stays on that framework (a WP→other migration
// breaks it) and describes the framework's machinery, not this element; a utility
// class is presentational and shared by hundreds of elements (no selectivity).
const CLASS_TIER_A = 0; // semantic / component name — author-authored identity
const CLASS_TIER_B = 1; // framework-namespaced — stable within, but coupled to, a framework
const CLASS_TIER_C = 2; // utility / atomic / layout — presentational, non-selective

/**
 * Framework namespace prefixes (WordPress core/blocks, popular page builders,
 * component libraries). Deliberately a conservative starter list — meant to
 * grow. A false demotion is low-harm: it only matters when a better (tier-A)
 * class is also present, in which case demoting the framework one is correct.
 */
function isFrameworkClass(cn: string): boolean {
  return (
    /^wp-/.test(cn) || // WordPress core / blocks
    /^(is|has)-/.test(cn) || // WP block-supports + common BEM-ish modifiers
    /^elementor(-|$)/.test(cn) || // Elementor
    /^et_pb_/.test(cn) || // Divi
    /^fusion-/.test(cn) || // Avada
    /^(vc_|wpb_)/.test(cn) || // WPBakery
    /^ast-/.test(cn) || // Astra theme
    /^(fl-node|fl-module)/.test(cn) || // Beaver Builder
    /^brxe-/.test(cn) || // Bricks
    /^(ant-|chakra-|Mui[A-Z]|oxy-)/.test(cn) // Ant / Chakra / MUI / Oxygen
  );
}

/**
 * Utility / atomic / grid classes: presentational, shared by many elements, so
 * they add path length without narrowing identity. Bootstrap layout + grid +
 * spacing/display helpers, WP alignment, common atomic spacing shapes. Also a
 * conservative starter list.
 */
function isUtilityClass(cn: string): boolean {
  return (
    /^align(full|wide|left|right|center|none)$/.test(cn) || // WP alignment
    /^(row|container|container-fluid)$/.test(cn) || // Bootstrap layout
    /^col(-(xs|sm|md|lg|xl|xxl))?(-\d{1,2})?$/.test(cn) || // Bootstrap grid col
    /^d-(flex|block|inline|inline-block|none|grid)$/.test(cn) || // display
    /^(offset|order|g|gx|gy)-\d/.test(cn) || // grid helpers
    /^(justify-content|align-items|align-self|text)-[a-z]+$/.test(cn) || // flex/text
    /^[mp][trblxyse]?-\d{1,2}$/.test(cn) // spacing: m-2, px-4
  );
}

/** Rank a (already stable) class by identity quality. Lower = better. */
function classTier(cn: string): number {
  if (isUtilityClass(cn)) return CLASS_TIER_C;
  if (isFrameworkClass(cn)) return CLASS_TIER_B;
  return CLASS_TIER_A;
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
// and therefore ranks ABOVE class. The remaining semantic attributes are NOT a
// single block below class — they interleave with the class tiers by quality
// (see nonIdSegment):
//     tier-A class > aria-label > tier-B class > role > tier-C class
//       > [class*=stem] > rel
// `aria-label` is an explicit accessible name (strong identity), so it out-ranks
// a framework/utility class it describes better — but it sits below a
// hand-authored semantic class because it is localized (differs across
// translated copies of a logical page). `role` is a coarse but i18n-stable
// landmark/widget token, above only utility classes. Below every full class is
// the stripped *stem* of a CSS-Modules scoped class matched by substring
// (`[class*=stem]`), a loose last resort. `rel` is weakest.

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

/** The first stable segment among the given attribute names (`tag[attr="v"]`), or null. */
function attrSegment(el: Element, names: string[]): string | null {
  const tag = el.tagName.toLowerCase();
  for (const name of names) {
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
 *  - stable class + semantic attribute, interleaved by quality:
 *    tier-A class > `aria-label` > tier-B class > `role` > tier-C class >
 *    `[class*=stem]` > `rel` (a low-quality class loses to an explicit
 *    accessible name / landmark role; a CSS-Modules stem matched by substring
 *    is a loose last resort below every full class)
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
): { seg: string; stop?: boolean; stopId?: string; classTier?: number } | null {
  const tag = el.tagName.toLowerCase();

  const url = urlSegment(el);
  if (url) return { seg: url };

  const nameSeg = nameSegment(el);
  if (nameSeg) return { seg: nameSeg };

  // Class and semantic attributes interleave by quality (see comment above):
  //   tier-A class > aria-label > tier-B class > role > tier-C class >
  //   [class*=stem] > rel.
  // Pick the element's best-quality stable class once (and, separately, the
  // richest CSS-Modules stem for the last-resort substring match), then walk the
  // interleaved ladder. `classTier` is reported so the path builder can later
  // shed a *redundant* low-quality class ancestor.
  let bestClass: { cn: string; tier: number } | null = null;
  let bestStem: string | null = null;
  if (el.classList) {
    for (const cn of Array.from(el.classList)) {
      if (isStableClass(cn)) {
        const tier = classTier(cn);
        if (!bestClass || tier < bestClass.tier) bestClass = { cn, tier };
        if (tier === CLASS_TIER_A) break; // nothing beats tier A; keep the first one
        continue;
      }
      // Not usable as a full `.class`, but a CSS-Modules scoped name still
      // carries identity in its stem — remember the richest one for a
      // last-resort `[class*="stem"]` match (see below). Only a *specific*
      // multi-token stem qualifies (a hyphen/underscore or a camelCase hump):
      // a bare single-word stem (`css` from an emotion `css-175oi2r`) is too
      // generic for a substring match and would match half the page.
      const stem = moduleClassStem(cn);
      if (
        stem &&
        (/[-_]/.test(stem) || /[a-z][A-Z]/.test(stem)) &&
        (!bestStem || stem.length > bestStem.length)
      )
        bestStem = stem;
    }
  }
  const classSeg = bestClass
    ? { seg: tag + '.' + cssEsc(bestClass.cn, true), classTier: bestClass.tier }
    : null;

  if (classSeg && bestClass!.tier === CLASS_TIER_A) return classSeg;

  const ariaSeg = attrSegment(el, ['aria-label']);
  if (ariaSeg) return { seg: ariaSeg };

  if (classSeg && bestClass!.tier === CLASS_TIER_B) return classSeg;

  const roleSeg = attrSegment(el, ['role']);
  if (roleSeg) return { seg: roleSeg };

  if (classSeg) return classSeg; // tier C — still better than rel / structural anchors

  // Last-resort class identity: match the stable *stem* of a CSS-Modules scoped
  // class whose per-build hash suffix we stripped (`[class*="Card-cardContent"]`).
  // A substring match can over-match a sibling stem, so it sits below every full
  // class and semantic attribute — used only when nothing better identifies the
  // element — but still above `rel` and the structural id anchors.
  if (bestStem) {
    return { seg: tag + '[class*="' + cssEsc(bestStem, false) + '"]' };
  }

  const relSeg = attrSegment(el, ['rel']);
  if (relSeg) return { seg: relSeg };

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
 * `nonIdSegment` (url > name > {class/aria-label/role/rel interleaved by
 * quality} > `:has(#id)` > `prev#id + tag`). A purely structural element (none
 * of these) returns null and is dropped from the path.
 *
 * A *weak*, CMS-enumerated id (`block-12`, see isWeakId) is NOT a unique handle,
 * so it never replaces the element's real identity and never stops the walk.
 * Instead `seg` carries the element's non-id identity (or null) and `weakSeg`
 * carries that same identity *augmented* with the weak id (`div.block#block-12`,
 * or `div#block-12` when there's nothing else). semanticSelector uses `weakSeg`
 * only when the weak-id-free selector turns out ambiguous.
 */
function semanticSegment(el: Element): {
  seg: string | null;
  stop?: boolean;
  stopId?: string;
  weakSeg?: string;
  classTier?: number;
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
      classTier: rest?.classTier,
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
function ambiguousId(id: string, root: Element | ShadowRoot): boolean {
  try {
    return root.querySelectorAll(idSelector(id)).length > 1;
  } catch {
    return false;
  }
}

/**
 * Drop the leading tag qualifier from an *ancestor* segment. The tag is a cheap,
 * intrinsic correctness constraint on the terminal (clicked) element — it stops
 * `div.entry-content` from relocating onto a `<section class="entry-content">` a
 * redesign introduces — but on the ancestors it climbs through it is pure
 * verbosity: `div.wp-block-group` → `.wp-block-group`, `main#skip` → `#skip`,
 * `a[href="/x"]` → `[href="/x"]`, `h1#intro + p` → `#intro + p`.
 *
 * Only a leading tag immediately followed by an id/class/attr/pseudo is removed,
 * so the remainder is always still a valid selector; ancestors that are a bare
 * tag are never produced (structural ancestors are dropped from the path
 * entirely), so there's nothing to accidentally strip to empty. For a
 * `prev#id + tag` sibling anchor this drops only the anchor's (redundant, since
 * the id is unique) tag, keeping the trailing element tag the combinator needs.
 */
function stripLeadingTag(seg: string): string {
  return seg.replace(/^[a-z][a-z0-9-]*(?=[.#[:])/i, '');
}

/** One collected path segment plus the metadata the pruner needs. */
interface PathSeg {
  text: string;
  /** A redundant-if-removable, low-quality (tier B/C) class ancestor. */
  droppable: boolean;
  /** Drop order among droppables — worst (tier C) tried first. */
  tier: number;
}

/**
 * Shed redundant low-quality class ancestors from a collected path.
 *
 * A segment "earns its place" iff removing it *increases* the match set. Because
 * removing any segment only ever loosens the selector (the target always stays
 * in the match set), an unchanged count means that segment added no selectivity
 * — it is redundant. A redundant segment is worth dropping ONLY when it is also
 * low quality (a framework/utility class, tier B/C): it is then pure cost —
 * extra length AND an extra intermediate anchor that breaks if that wrapper is
 * restructured away between page versions. A redundant *semantic* (tier-A)
 * class is kept: it scopes the element meaningfully and guards against unrelated
 * elements matching on a future version of the page. Strong-id anchors and the
 * terminal are never candidates (a redundant strong-id anchor is deliberately
 * kept — one segment, huge selectivity, cheap cross-time insurance).
 *
 * Segments arrive terminal-first; the worst tier is tried first so that if two
 * low-quality classes are interdependent the higher-quality one survives.
 */
function pruneRedundant(
  segs: PathSeg[],
  root: Element | ShadowRoot,
): PathSeg[] {
  const candidates = segs.filter((s) => s.droppable);
  if (candidates.length === 0) return segs;
  candidates.sort((a, b) => b.tier - a.tier); // tier C before tier B

  const selectorOf = (list: PathSeg[]) =>
    list
      .map((s) => s.text)
      .reverse()
      .join(' ');
  const countOf = (sel: string): number => {
    try {
      return root.querySelectorAll(sel).length;
    } catch {
      return -1; // unresolvable in this engine — treat as "can't safely drop"
    }
  };

  let current = segs;
  const count = countOf(selectorOf(current));
  if (count < 0) return segs; // base selector not resolvable — leave it alone

  for (const cand of candidates) {
    const trial = current.filter((s) => s !== cand);
    if (countOf(selectorOf(trial)) === count) current = trial; // redundant → drop
  }
  return current;
}

/**
 * Walk an element's ancestor path and join its identity segments with
 * descendant combinators. Purely structural ancestors (no id/url/class/`:has`
 * anchor) are omitted — we never emit positional `nth-of-type` ordinals.
 *
 * Only the terminal (clicked) element keeps its tag qualifier; every ancestor
 * segment is tag-stripped (see stripLeadingTag) to keep the selector terse,
 * since the tag adds no identity there. The collected path is then run through
 * pruneRedundant to shed redundant low-quality class ancestors.
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
  root: Element | ShadowRoot,
  includeWeak: boolean,
  dedupeIds: boolean,
): string {
  const segments: PathSeg[] = [];
  let current: Element | null = el;
  let isTerminal = true;

  while (current && current !== root && current !== document.documentElement) {
    const seg = semanticSegment(current);
    const chosen = seg
      ? includeWeak && seg.weakSeg
        ? seg.weakSeg
        : seg.seg
      : null;
    if (chosen) {
      const usedWeak = !!(includeWeak && seg && seg.weakSeg);
      const isAnchor = !!(seg && seg.stop);
      // Only a *class* segment carries a tier; url/name/attr/:has/anchor/bare-tag
      // default to tier A and are never redundancy-droppable. A weakSeg is
      // id-bearing (present only because it disambiguates) → also never dropped.
      const tier = seg && seg.classTier != null ? seg.classTier : CLASS_TIER_A;
      const droppable =
        !isTerminal && !isAnchor && !usedWeak && tier >= CLASS_TIER_B;
      // The clicked element keeps its tag (a cheap identity constraint); every
      // ancestor is tag-stripped — the tag carries no identity there.
      segments.push({
        text: isTerminal ? chosen : stripLeadingTag(chosen),
        droppable,
        tier,
      });
      if (isAnchor) {
        // A stop assumes its anchoring id (`seg.stopId`) is a unique handle —
        // either the element's own id or a strong id on its immediate preceding
        // sibling (`prev#id + tag`). When dedupeIds is set and that id is
        // duplicated in root (malformed markup), keep the segment but climb on
        // so an ancestor disambiguates.
        const ambiguousStop =
          dedupeIds && !!seg!.stopId && ambiguousId(seg!.stopId!, root);
        if (!ambiguousStop) break;
      }
    } else if (isTerminal) {
      // The clicked element itself has no usable identity — keep a bare tag so
      // the selector still resolves to it (refined by match index + geometry).
      segments.push({
        text: current.tagName.toLowerCase(),
        droppable: false,
        tier: CLASS_TIER_A,
      });
    }
    current = current.parentElement;
    isTerminal = false;
  }

  return pruneRedundant(segments, root)
    .map((s) => s.text)
    .reverse()
    .join(' ');
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
export function semanticSelector(
  el: Element,
  root: Element | ShadowRoot = document.body,
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
