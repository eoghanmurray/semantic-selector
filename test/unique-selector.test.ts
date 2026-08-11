/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { semanticSelector } from '../src/index';

/**
 * Helper: set document.body innerHTML and return body as root.
 * Use data-target="name" to mark the element you want to test,
 * then call target('name') to get it.
 */
function setHTML(html: string) {
  document.body.innerHTML = html;
}

function target(name = 'target'): HTMLElement {
  const el = document.querySelector(`[data-target="${name}"]`);
  if (!el) throw new Error(`No element with data-target="${name}"`);
  return el as HTMLElement;
}

/** Build the identity-only selector and assert it's non-empty. */
function sel(el: Element, root: HTMLElement = document.body): string {
  const s = semanticSelector(el, root);
  expect(s).toBeTruthy();
  return s;
}

/** How many elements the selector resolves to under `root`. */
function matchCount(s: string, root: HTMLElement = document.body): number {
  return root.querySelectorAll(s).length;
}

/** Assert the selector resolves uniquely to the expected element. */
function expectResolves(
  el: Element,
  root: HTMLElement = document.body,
): string {
  const s = sel(el, root);
  const matches = root.querySelectorAll(s);
  expect(matches.length).toBe(1);
  expect(matches[0]).toBe(el);
  return s;
}

describe('semanticSelector', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  // -------------------------------------------------------------------
  // Basic element identification
  // -------------------------------------------------------------------

  describe('basic elements', () => {
    it('selects a sole button by its bare tag', () => {
      setHTML('<div><button data-target="target">Click me</button></div>');
      // No identity to latch onto — terminal bare tag, structural div dropped.
      expect(expectResolves(target())).toBe('button');
    });

    it('collapses identity-less sibling buttons to the same selector', () => {
      setHTML(`
        <div>
          <button>First</button>
          <button data-target="target">Second</button>
          <button>Third</button>
        </div>
      `);
      // Identity-only: no positional ordinal. All three share one selector;
      // residual ambiguity is the caller's matchIndex/matchCount job.
      const s = sel(target());
      expect(s).toBe('button');
      expect(matchCount(s)).toBe(3);
    });

    it('selects a link by its href', () => {
      setHTML(
        '<nav><a href="/home">Home</a><a href="/about" data-target="target">About</a></nav>',
      );
      expect(expectResolves(target())).toBe('a[href="/about"]');
    });

    it('selects an input element by bare tag', () => {
      setHTML(`
        <form>
          <input type="text" name="email">
          <input type="submit" value="Go" data-target="target">
        </form>
      `);
      // Inputs carry no identity here — bare tag, ambiguous with the text input.
      expect(sel(target())).toBe('input');
    });
  });

  // -------------------------------------------------------------------
  // ID-based selection
  // -------------------------------------------------------------------

  describe('ID-based selectors', () => {
    it('uses a stable ID directly (with its tag)', () => {
      setHTML(
        '<div><span id="main-cta" data-target="target">Buy Now</span></div>',
      );
      expect(expectResolves(target())).toBe('span#main-cta');
    });

    it('anchors from a parent ID', () => {
      setHTML(`
        <div id="sidebar">
          <ul>
            <li>One</li>
            <li data-target="target">Two</li>
          </ul>
        </div>
      `);
      const s = sel(target());
      expect(s).toContain('#sidebar');
      // ul is structural and dropped; descendant combinator skips it. The
      // ancestor #sidebar sheds its tag; only the terminal keeps one (bare li).
      expect(s).toBe('#sidebar li');
    });

    it('accepts purely numeric IDs via an [id="..."] selector', () => {
      // Numeric ids are usually stable DB row ids; an attribute selector
      // relocates the element more reliably than a structural fallback.
      setHTML('<div id="12345"><span data-target="target">Text</span></div>');
      const s = sel(target());
      expect(s).toContain('[id="12345"]');
      expect(s).not.toContain('#12345'); // never the fragile numeric-escaped form
    });

    it('accepts long numeric IDs but still rejects hex hashes', () => {
      // An 8+ digit DB id is fine; a like-length hex hash (has a-f) is not.
      setHTML(
        '<div id="100234567"><span data-target="target">Text</span></div>',
      );
      expect(sel(target())).toContain('[id="100234567"]');
      setHTML('<div id="89abcd01"><span data-target="other">Text</span></div>');
      expect(sel(target('other'))).not.toContain('89abcd01');
    });

    it('uses an [id="..."] attribute selector for IDs starting with a digit', () => {
      // A `#id` for a digit-leading id needs an ugly numeric escape
      // (#\32 024-promo); the attribute form is valid and more robust.
      // (finder PR https://github.com/antonmedv/finder/pull/69)
      setHTML(
        '<div id="2024-promo"><span data-target="target">Text</span></div>',
      );
      const s = sel(target());
      expect(s).toContain('[id="2024-promo"]');
      expect(s).not.toContain('#');
    });

    it('rejects framework-generated IDs (ember)', () => {
      setHTML(
        '<div id="ember742"><span data-target="target">Text</span></div>',
      );
      expect(sel(target())).not.toContain('#ember742');
    });

    it('rejects UUIDs in IDs', () => {
      setHTML(
        '<div id="widget-a1b2c3d4e5f6a7b8"><span data-target="target">Text</span></div>',
      );
      expect(sel(target())).not.toContain('a1b2c3d4e5f6a7b8');
    });

    it('rejects a high-entropy ULID/nanoid token id', () => {
      // A base32 token like `016JB91MZ80000000000036PNV` is regenerated per
      // render/row-insert; the interleaved letter/digit runs give it away even
      // though it is not hex (no a–f). Falls back to the class instead.
      setHTML(
        '<div id="rich-text-016JB91MZ80000000000036PNV" class="prose"><span data-target="target">Text</span></div>',
      );
      const s = sel(target());
      expect(s).not.toContain('016JB91MZ80000000000036PNV');
      expect(s).toContain('.prose');
    });

    it('keeps a word-plus-number id (not a random token)', () => {
      // `heading2` is a word with a trailing number — one letter run, one digit
      // run — so it stays strong, unlike an interleaved random token.
      setHTML(
        '<div id="heading2"><span data-target="target">Text</span></div>',
      );
      expect(sel(target())).toContain('#heading2');
    });

    it('picks a semantic class over a real-world ULID form-block id', () => {
      // Minimal, anonymised subtree from a Klaviyo signup form seen in the wild:
      // every block gets an `id="rich-text-<ULID>"` that Klaviyo regenerates, so
      // pinning on it would never reoccur. The same element carries a durable
      // `klaviyo-form-richtext` class, which we use instead.
      setHTML(`
        <div role="dialog" aria-label="Signup Form" class="needsclick kl-private-reset-css-Xuajs1">
          <form novalidate class="needsclick klaviyo-form kl-private-reset-css-Xuajs1">
            <div data-testid="form-row" class="needsclick kl-private-reset-css-Xuajs1">
              <div data-testid="form-component" class="needsclick go2454621715 kl-private-reset-css-Xuajs1">
                <div id="rich-text-016JB91TTR0000000000362ECS" class="kl-private-reset-css-Xuajs1 go3176171171 klaviyo-form-richtext" data-target="target">
                  <p>Placeholder heading</p>
                </div>
              </div>
            </div>
          </form>
        </div>
      `);
      const s = expectResolves(target());
      expect(s).not.toContain('rich-text-016JB91TTR0000000000362ECS');
      // The go*/hashed reset classes are rejected too; the terminal identity is
      // the authored component class.
      expect(s.endsWith('div.klaviyo-form-richtext')).toBe(true);
    });

    it('rejects React useId / Radix colon-wrapped IDs', () => {
      setHTML('<div id=":r0:"><span data-target="target">Text</span></div>');
      expect(sel(target())).not.toContain(':r0:');
    });

    it('rejects MUI auto-generated IDs', () => {
      setHTML('<div id="mui-42"><span data-target="target">Text</span></div>');
      expect(sel(target())).not.toContain('mui-42');
    });

    it('rejects Headless UI IDs', () => {
      setHTML(
        '<div id="headlessui-menu-button-1"><span data-target="target">Text</span></div>',
      );
      expect(sel(target())).not.toContain('headlessui');
    });

    it('rejects Radix UI IDs', () => {
      setHTML('<div id="radix-3"><span data-target="target">Text</span></div>');
      expect(sel(target())).not.toContain('radix-3');
    });

    it('rejects Angular Material / CDK sequential IDs', () => {
      setHTML(
        '<div id="mat-input-3"><span data-target="target">Text</span></div>',
      );
      expect(sel(target())).not.toContain('mat-input-3');
    });

    it('keeps a stable id that merely starts with a framework-ish prefix', () => {
      // "material" is not "mat-", "redux-store" is not "radix-": no false positives
      setHTML(
        '<div id="material-panel"><span data-target="target">Text</span></div>',
      );
      expect(sel(target())).toContain('#material-panel');
    });

    it('accepts a duplicated own id, leaving ambiguity to the match index', () => {
      // Malformed markup repeats an id. We no longer query the page to climb
      // past it (that made the selector depend on ambient page state); the own
      // id is the top rank and stops the walk. The duplicate collapses to one
      // selector, resolved out-of-band by matchIndex/geometry.
      setHTML(`
        <div id="content-wrapper" class="js-content-wrapper">
          <div class="row">
            <div id="content-wrapper" class="left-column col-md-9" data-target="target">x</div>
          </div>
        </div>
      `);
      expect(matchCount('#content-wrapper')).toBe(2);
      const s = sel(target());
      expect(s).toBe('div#content-wrapper');
      expect(matchCount(s)).toBe(2);
    });

    it('leaves genuinely indistinguishable duplicate ids to the match index', () => {
      // Two siblings sharing an id with no disambiguating ancestor: climbing
      // can't help, so we keep the id selector and let matchIndex/geometry sort
      // it out (count 2) rather than inventing a positional ordinal.
      setHTML(`
        <div id="dup">a</div>
        <div id="dup" data-target="target">b</div>
      `);
      const s = sel(target());
      expect(s).toBe('div#dup');
      expect(matchCount(s)).toBe(2);
    });
  });

  // -------------------------------------------------------------------
  // CMS-enumerated IDs (block-12 style). There is no weak/strong split: any
  // stable id is one top-rank identity that stops the walk. If it renumbers
  // between page versions the resulting mismatch is the caller's
  // matchIndex/geometry problem, like any other collapsed identity.
  // -------------------------------------------------------------------

  describe('enumerated IDs (block-12 style)', () => {
    it('uses an enumerated id directly, like any stable id', () => {
      setHTML(
        '<section><div id="block-12" data-target="target">x</div></section>',
      );
      expect(sel(target())).toBe('div#block-12');
    });

    it('prefers an id over a class on the same element (id is the top rank)', () => {
      setHTML('<div class="hero" id="block-12" data-target="target">x</div>');
      expect(sel(target())).toBe('div#block-12');
    });

    it('uses an id with digits earlier in the stem (s3_1_offset_2)', () => {
      setHTML(
        '<section><div id="s3_1_offset_2" data-target="target">x</div></section>',
      );
      expect(sel(target())).toBe('div#s3_1_offset_2');
    });

    it('treats a separator-less trailing-number id (section2) the same', () => {
      setHTML('<div id="section2" data-target="target">x</div>');
      expect(sel(target())).toBe('div#section2');
    });

    it('stops on the NEAREST id ancestor when several ancestors have ids', () => {
      setHTML(`
        <div id="main">
          <div id="block-12">
            <a href="/buy" data-target="target">Buy</a>
          </div>
        </div>
      `);
      // Terminal a[href] is a url (rank 1); climbing, the nearest id ancestor
      // (#block-12) is the top rank and stops the walk — we never reach #main.
      expect(sel(target())).toBe('#block-12 a[href="/buy"]');
    });
  });

  // -------------------------------------------------------------------
  // Class-based selection
  // -------------------------------------------------------------------

  describe('class-based selectors', () => {
    it('uses a stable class, ignoring state classes', () => {
      setHTML(`
        <ul>
          <li class="nav-item">Home</li>
          <li class="nav-item active" data-target="target">About</li>
        </ul>
      `);
      // 'active' is a state class and is rejected; both share nav-item so the
      // class can't disambiguate — that's the matchIndex case, not nth-of-type.
      const s = sel(target());
      expect(s).toBe('li.nav-item');
      expect(s).not.toContain('active');
      expect(matchCount(s)).toBe(2);
    });

    it('rejects styled-components classes', () => {
      setHTML(`
        <div>
          <span class="sc-abc123" data-target="target">Styled</span>
          <span class="sc-def456">Other</span>
        </div>
      `);
      expect(sel(target())).not.toContain('sc-abc123');
    });

    it('rejects emotion CSS classes', () => {
      setHTML(`
        <div>
          <span class="css-1a2b3c" data-target="target">Emotion</span>
          <span class="css-4d5e6f">Other</span>
        </div>
      `);
      expect(sel(target())).not.toContain('css-1a2b3c');
    });

    it('rejects a CSS-Modules hashed class, preferring a plain class', () => {
      // `Card-cardContent-Zu3Ce` carries a per-build hash suffix that changes
      // every deploy; a genuine class on the element wins outright.
      setHTML(`
        <div>
          <div class="Card-cardContent-Zu3Ce article-body" data-target="target">x</div>
        </div>
      `);
      const s = sel(target());
      expect(s).toBe('div.article-body');
      expect(s).not.toContain('Zu3Ce');
    });

    it('matches a CSS-Modules stem by substring as a last resort', () => {
      // No other identity: fall back to `[class*="stem"]` on the authored stem,
      // which survives the hash suffix changing between deploys.
      setHTML(`
        <div>
          <div class="routing-routeTransitionContainer-CNBnY" data-target="target">x</div>
        </div>
      `);
      const s = sel(target());
      expect(s).toBe('div[class*="routing-routeTransitionContainer"]');
      expect(s).not.toContain('CNBnY');
      expect(matchCount(s)).toBe(1);
    });

    it('does not mistake a plain camelCase/BEM class for a hashed one', () => {
      // `nav-navBar` has no random suffix (navBar is a real camelCase word, with
      // vowels); it is used whole, never stripped to a `[class*=]` stem.
      setHTML('<nav class="nav-navBar" data-target="target">x</nav>');
      const s = sel(target());
      expect(s).toBe('nav.nav-navBar');
      expect(s).not.toContain('class*');
    });

    it('rejects state classes like "active" or "selected"', () => {
      setHTML(`
        <div>
          <button class="btn active" data-target="target">OK</button>
          <button class="btn">Cancel</button>
        </div>
      `);
      const s = sel(target());
      expect(s).not.toContain('active');
      expect(s).toContain('btn');
    });

    it('rejects a transient state class carried on a BEM token', () => {
      // `plyr__tab-focus` is present only because the element was just focused —
      // recording it would pin on the act of recording. Matched per token, so
      // `focus` is rejected but the sibling `plyr__control` is kept.
      setHTML(`
        <div>
          <button class="plyr__tab-focus plyr__control" data-target="target">Play</button>
        </div>
      `);
      const s = sel(target());
      expect(s).toBe('button.plyr__control');
      expect(s).not.toContain('focus');
    });

    it('rejects interaction states beyond the original list (pressed, expanded)', () => {
      setHTML(`
        <div>
          <button class="accordion-trigger is-expanded pressed" data-target="target">More</button>
        </div>
      `);
      const s = sel(target());
      expect(s).toBe('button.accordion-trigger');
      expect(s).not.toContain('expanded');
      expect(s).not.toContain('pressed');
    });

    it('keeps content classes that merely contain a state word', () => {
      // Per-token matching: `opengraph` is not the token `open`, `focusable` is
      // not `focus` — substring matching wrongly rejected these.
      setHTML(
        '<section class="opengraph-preview" data-target="target">x</section>',
      );
      expect(sel(target())).toBe('section.opengraph-preview');
    });

    it('uses a stable class that uniquely identifies among siblings', () => {
      setHTML(`
        <div>
          <span class="primary-link" data-target="target">Buy</span>
          <span class="secondary-link">Info</span>
        </div>
      `);
      expect(expectResolves(target())).toBe('span.primary-link');
    });

    it('picks the best-quality class, not the first in DOM order', () => {
      // A WordPress block lists framework/utility classes before the semantic
      // one; we must still pick `entry-content` (tier A) over `alignfull`
      // (utility) and `wp-block-post-content` / `is-layout-constrained` (framework).
      setHTML(`
        <div>
          <div class="alignfull wp-block-post-content entry-content is-layout-constrained" data-target="target">x</div>
        </div>
      `);
      expect(sel(target())).toBe('div.entry-content');
    });

    it('falls back to a framework class when no semantic class exists', () => {
      // alignfull is utility (tier C), wp-block-group framework (tier B): B wins.
      setHTML(
        '<div class="alignfull wp-block-group" data-target="target">x</div>',
      );
      expect(sel(target())).toBe('div.wp-block-group');
    });

    it('rejects an absurdly long (generated) class name', () => {
      const longClass = 'x' + 'a'.repeat(80); // 81 chars, > MAX_IDENT_LEN
      setHTML(`
        <div>
          <span class="${longClass}" data-target="target">Buy</span>
          <span class="other">Info</span>
        </div>
      `);
      const s = sel(target());
      expect(s).not.toContain(longClass);
      expect(s).toBe('span'); // no usable identity → bare tag
    });
  });

  // -------------------------------------------------------------------
  // Semantic attribute selection (name / aria-label / role / rel)
  // -------------------------------------------------------------------

  describe('semantic attributes', () => {
    it('anchors a control by its name', () => {
      setHTML(
        '<form><input type="email"><button name="place-order" data-target="target">Pay</button></form>',
      );
      expect(expectResolves(target())).toBe('button[name="place-order"]');
    });

    it('anchors by aria-label when there is no class', () => {
      setHTML(
        '<div><button aria-label="Close dialog" data-target="target">x</button></div>',
      );
      expect(expectResolves(target())).toBe(
        'button[aria-label="Close dialog"]',
      );
    });

    it('uses role as a (weak) anchor', () => {
      setHTML(
        '<div role="navigation" data-target="target"><a href="/a">A</a></div>',
      );
      expect(sel(target())).toBe('div[role="navigation"]');
    });

    it("prefers a control's name over a stable class", () => {
      // name is the backend submission key — more durable than styling classes,
      // which redesigns rewrite. So it outranks class on form controls.
      setHTML(
        '<button class="cta" name="submit-order" data-target="target">Go</button>',
      );
      const s = sel(target());
      expect(s).toBe('button[name="submit-order"]');
      expect(s).not.toContain('.cta');
    });

    it('prefers a SEMANTIC (tier-A) class over aria-label', () => {
      // A hand-authored class beats aria-label (which is localized / i18n-fragile).
      setHTML(
        '<div class="hero" aria-label="Hero banner" data-target="target">x</div>',
      );
      const s = sel(target());
      expect(s).toBe('div.hero');
      expect(s).not.toContain('aria-label=');
    });

    it('prefers aria-label over a low-quality framework class', () => {
      // The only class is framework-namespaced (tier B) — the explicit accessible
      // name describes the element better, so it wins.
      setHTML(
        '<button class="wp-block-search__button" aria-label="Search" data-target="target">x</button>',
      );
      const s = sel(target());
      expect(s).toBe('button[aria-label="Search"]');
      expect(s).not.toContain('wp-block-search');
    });

    it('prefers aria-label over a utility class', () => {
      setHTML(
        '<div class="col-md-9" aria-label="Main content" data-target="target">x</div>',
      );
      const s = sel(target());
      expect(s).toBe('div[aria-label="Main content"]');
      expect(s).not.toContain('col-md-9');
    });

    it('prefers a framework (tier-B) class over a coarse role', () => {
      // A framework class is more specific than the coarse, shared role token.
      setHTML(
        '<div class="wp-block-navigation" role="navigation" data-target="target">x</div>',
      );
      expect(sel(target())).toBe('div.wp-block-navigation');
    });

    it('prefers a landmark role over a utility class', () => {
      // role is semantic (about purpose) and i18n-stable; a utility class is
      // presentational — so role wins over tier C.
      setHTML('<div class="d-flex" role="search" data-target="target">x</div>');
      const s = sel(target());
      expect(s).toBe('div[role="search"]');
      expect(s).not.toContain('d-flex');
    });

    it('only promotes name on form controls, not arbitrary tags', () => {
      // A non-control element's `name` is non-standard; class still wins there.
      setHTML(
        '<div class="panel" name="whatever" data-target="target">x</div>',
      );
      expect(sel(target())).toBe('div.panel');
    });

    it('prefers an href url over a control name', () => {
      setHTML('<a href="/buy" name="buy-link" data-target="target">Buy</a>');
      expect(sel(target())).toBe('a[href="/buy"]');
    });

    it('rejects auto-generated-looking attribute values', () => {
      setHTML('<button name="field-20487" data-target="target">x</button>');
      const s = sel(target());
      expect(s).toBe('button');
      expect(s).not.toContain('name=');
    });

    it('rejects random-hash attribute values', () => {
      setHTML('<button name="a8f3b9c2d1e7" data-target="target">x</button>');
      expect(sel(target())).not.toContain('name=');
    });

    it('escapes quotes in attribute values', () => {
      setHTML(
        '<button aria-label="Say &quot;hi&quot;" data-target="target">x</button>',
      );
      const s = sel(target());
      expect(s).toContain('aria-label=');
      // resolves without throwing
      expect(matchCount(s)).toBe(1);
    });
  });

  // -------------------------------------------------------------------
  // Structural elements — dropped from the path unless terminal
  // -------------------------------------------------------------------

  describe('structural elements', () => {
    it('drops identity-less ancestors entirely', () => {
      setHTML(`
        <div>
          <div>
            <div>
              <span data-target="target">Deep</span>
            </div>
          </div>
        </div>
      `);
      // Only the terminal survives; every wrapper div is dropped.
      expect(sel(target())).toBe('span');
    });

    it('emits no positional ordinal for a sole structural div', () => {
      setHTML(`
        <section>
          <div data-target="target">
            <p>Content</p>
          </div>
        </section>
      `);
      const s = sel(target());
      expect(s).toBe('div');
      expect(s).not.toContain('nth-of-type');
    });

    it('collapses sibling divs to the same selector (no nth-of-type)', () => {
      setHTML(`
        <main>
          <div>First</div>
          <div>Second</div>
          <div data-target="target">Third</div>
        </main>
      `);
      const s = sel(target());
      expect(s).toBe('div');
      expect(s).not.toContain('nth-of-type');
      expect(matchCount(s)).toBe(3);
    });

    it('uses the href of a link among mixed siblings', () => {
      setHTML(`
        <div>
          <h2>Title</h2>
          <p>Paragraph</p>
          <a href="/link" data-target="target">Link</a>
          <p>Another paragraph</p>
        </div>
      `);
      expect(expectResolves(target())).toBe('a[href="/link"]');
    });
  });

  // -------------------------------------------------------------------
  // Real-world page patterns
  // -------------------------------------------------------------------

  describe('real-world patterns', () => {
    it('navigation menu with links', () => {
      setHTML(`
        <nav id="main-nav">
          <ul>
            <li><a href="/">Home</a></li>
            <li><a href="/products">Products</a></li>
            <li><a href="/about" data-target="target">About</a></li>
            <li><a href="/contact">Contact</a></li>
          </ul>
        </nav>
      `);
      const s = expectResolves(target());
      // href identity, anchored under the nav's stable id (structural li/ul dropped).
      expect(s).toBe('#main-nav a[href="/about"]');
    });

    it('product grid cards', () => {
      setHTML(`
        <div class="product-grid">
          <div class="product-card">
            <img src="/img/1.jpg"><h3>Product A</h3>
            <button>Add to Cart</button>
          </div>
          <div class="product-card">
            <img src="/img/2.jpg"><h3>Product B</h3>
            <button data-target="target">Add to Cart</button>
          </div>
          <div class="product-card">
            <img src="/img/3.jpg"><h3>Product C</h3>
            <button>Add to Cart</button>
          </div>
        </div>
      `);
      const s = sel(target());
      // `.product-card` (tier A) is the terminal's best ancestor identity; the
      // outer `.product-grid` is the same tier, so the ratchet skips it as no
      // improvement. Three identical cards — ambiguity resolved by matchIndex.
      expect(s).toBe('.product-card button');
      expect(matchCount(s)).toBe(3);
    });

    it('form with submit button', () => {
      setHTML(`
        <div id="checkout">
          <form>
            <input type="text" placeholder="Name">
            <input type="email" placeholder="Email">
            <button type="submit" data-target="target">Place Order</button>
          </form>
        </div>
      `);
      const s = expectResolves(target());
      expect(s).toContain('#checkout');
      expect(s).toBe('#checkout button');
    });

    it('footer with multiple link sections', () => {
      setHTML(`
        <footer>
          <div class="footer-col">
            <a href="/terms">Terms</a>
            <a href="/privacy">Privacy</a>
          </div>
          <div class="footer-col">
            <a href="/blog">Blog</a>
            <a href="/careers" data-target="target">Careers</a>
          </div>
        </footer>
      `);
      // The href is the anchor's identity; the nearest identity ancestor
      // (`.footer-col`) is kept as the container anchor — which column of links.
      expect(expectResolves(target())).toBe('.footer-col a[href="/careers"]');
    });

    it('table rows with action buttons', () => {
      setHTML(`
        <table>
          <tbody>
            <tr><td>Row 1</td><td><button>Edit</button></td></tr>
            <tr><td>Row 2</td><td><button data-target="target">Edit</button></td></tr>
            <tr><td>Row 3</td><td><button>Edit</button></td></tr>
          </tbody>
        </table>
      `);
      const s = sel(target());
      expect(s).toBe('button');
      expect(matchCount(s)).toBe(3);
    });

    it('hero section with CTA', () => {
      setHTML(`
        <section class="hero">
          <h1>Welcome</h1>
          <p>Some description text here.</p>
          <a href="/signup" class="cta-button" data-target="target">Get Started</a>
        </section>
      `);
      const s = expectResolves(target());
      // href wins over the anchor's own cta-button class; the nearest identity
      // ancestor `.hero` is still kept as the container anchor.
      expect(s).toBe('.hero a[href="/signup"]');
    });
  });

  // -------------------------------------------------------------------
  // Ancestor ratchet — climbing keeps only strictly-higher-quality identity,
  // so lower/equal-tier wrappers are skipped and an id anchor ends the walk.
  // -------------------------------------------------------------------

  describe('ancestor ratchet', () => {
    it('keeps the nearest framework ancestor as anchor, then stops at the id', () => {
      // Minimal extract of a WordPress page (abogado.html): a semantic-classed
      // content div inside a framework wrapper (.wp-block-group), under the
      // theme's skip-link landmark id. The nearest identity ancestor
      // (.wp-block-group) is kept as the container anchor; higher tier-A wrappers
      // would need to out-rank it, and the id ancestor is the top rank and stops.
      setHTML(`
        <main id="wp--skip-link--target">
          <div class="wp-block-group">
            <div class="entry-content alignfull wp-block-post-content" data-target="target">
              <p>content</p>
            </div>
          </div>
        </main>
      `);
      expect(expectResolves(target())).toBe(
        '#wp--skip-link--target .wp-block-group div.entry-content',
      );
    });

    it('keeps a redundant SEMANTIC-class ancestor for context', () => {
      // .product-card is tier A. Even though the lone button is unique without
      // it, the semantic wrapper is kept — it scopes the click meaningfully and
      // guards against unrelated buttons appearing on a later version of the page.
      setHTML(`
        <div class="product-card">
          <h3>Item</h3>
          <button data-target="target">Add to cart</button>
        </div>
      `);
      const s = sel(target());
      expect(s).toBe('.product-card button');
      expect(matchCount(s)).toBe(1);
    });

    it('keeps the container anchor, distinguishing identical links intrinsically', () => {
      // Two identical `/buy` links in differently-classed wrappers. The nearest
      // identity ancestor is always kept as the container anchor, so `.wp-block-group`
      // vs `.other` tells them apart — WITHOUT querying the page (unlike the old
      // pruner). Same-container siblings would still collapse; different
      // containers get different selectors, which is the meaningful distinction.
      setHTML(`
        <div class="wp-block-group">
          <a href="/buy" data-target="target">Buy</a>
        </div>
        <div class="other">
          <a href="/buy">Buy</a>
        </div>
      `);
      const s = sel(target());
      expect(s).toBe('.wp-block-group a[href="/buy"]');
      expect(matchCount(s)).toBe(1);
    });
  });

  // -------------------------------------------------------------------
  // Stability: identity-anchored selectors survive minor page changes
  // -------------------------------------------------------------------

  describe('selector stability', () => {
    it('selector anchored by ID + unique class survives sibling additions', () => {
      setHTML(`
        <main id="content">
          <div class="first-card">
            <button data-target="target">Click</button>
          </div>
        </main>
      `);
      const s = expectResolves(target());
      expect(s).toContain('#content');

      // Add a sibling with a DIFFERENT class
      const newDiv = document.createElement('div');
      newDiv.className = 'second-card';
      newDiv.innerHTML = '<button>Other</button>';
      document.querySelector('#content')!.appendChild(newDiv);

      // Selector used unique class "first-card", so it still resolves uniquely.
      const matches = document.body.querySelectorAll(s);
      expect(matches.length).toBe(1);
      expect(matches[0]).toBe(target());
    });

    it('identity-less siblings share one selector (the matchIndex case)', () => {
      // No id/class/href to latch onto, so both <li> collapse to "li". This is
      // residual ambiguity by design — not a fragile positional ordinal that
      // silently retargets when a sibling is prepended.
      setHTML(`
        <ul>
          <li data-target="target">First</li>
          <li>Second</li>
        </ul>
      `);
      const s = sel(target());
      expect(s).toBe('li');
      expect(s).not.toContain('nth-of-type');
      expect(matchCount(s)).toBe(2);

      // Prepending a sibling doesn't change the selector — it just grows the
      // match set; the index/geometry recorded alongside it does the resolving.
      const newLi = document.createElement('li');
      newLi.textContent = 'Zeroth';
      document.querySelector('ul')!.prepend(newLi);
      expect(matchCount(s)).toBe(3);
    });
  });

  // -------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles elements with special characters in IDs', () => {
      setHTML(
        '<div id="my-widget"><span data-target="target">Text</span></div>',
      );
      expect(sel(target())).toContain('#my-widget');
    });

    it('handles IDs with colons by escaping them', () => {
      setHTML(
        '<div id="my:widget"><span data-target="target">Text</span></div>',
      );
      // Colon in ID must be escaped for CSS selector
      expect(sel(target())).toContain('my\\:widget');
    });

    it('handles elements with no parent (body direct child)', () => {
      setHTML('<button data-target="target">Solo</button>');
      expect(sel(target())).toBe('button');
    });

    it('handles deeply nested identical structures', () => {
      setHTML(`
        <div>
          <div><div><span>A</span></div></div>
          <div><div><span data-target="target">B</span></div></div>
          <div><div><span>C</span></div></div>
        </div>
      `);
      const s = sel(target());
      expect(s).toBe('span');
      expect(matchCount(s)).toBe(3);
    });

    it('handles SVG elements gracefully', () => {
      setHTML(`
        <div>
          <svg data-target="target" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="40"/>
          </svg>
        </div>
      `);
      // SVG elements are Element but not HTMLElement — should still work
      const el = document.querySelector('[data-target="target"]') as Element;
      const s = semanticSelector(el, document.body);
      expect(s).toBeTruthy();
      const matches = document.body.querySelectorAll(s);
      expect(matches.length).toBe(1);
      expect(matches[0]).toBe(el);
    });

    it('returns a string for elements not in body', () => {
      const detached = document.createElement('div');
      const child = document.createElement('span');
      detached.appendChild(child);
      // Not in DOM — should handle gracefully
      const s = semanticSelector(child, document.body);
      expect(typeof s).toBe('string');
    });

    it('handles elements with many classes, only some stable', () => {
      setHTML(`
        <div>
          <button class="sc-abc styled__xyz css-123 primary-action" data-target="target">Go</button>
          <button class="sc-def styled__uvw css-456 secondary-action">No</button>
        </div>
      `);
      const s = sel(target());
      expect(s).toContain('primary-action');
      expect(s).not.toContain('sc-abc');
      expect(s).not.toContain('styled__xyz');
      expect(s).not.toContain('css-123');
    });
  });

  // -------------------------------------------------------------------
  // URL-in-selector (links / images)
  // finder PR: https://github.com/antonmedv/finder/pull/74
  // -------------------------------------------------------------------

  describe('url matching', () => {
    it('embeds a link href as a standalone selector', () => {
      setHTML('<nav><a href="/products">Products</a></nav>');
      expect(expectResolves(document.querySelector('a')!)).toBe(
        'a[href="/products"]',
      );
    });

    it('embeds an img src', () => {
      setHTML('<div><img src="/logo.png" data-target="target"></div>');
      expect(expectResolves(target())).toBe('img[src="/logo.png"]');
    });

    it('lops off a multi-param query with a prefix match', () => {
      setHTML('<a href="/article?utm_source=x&utm_medium=y">A</a>');
      expect(sel(document.querySelector('a')!)).toBe('a[href^="/article"]');
    });

    it('lops off a single tracking-param query (fbclid)', () => {
      setHTML('<a href="/page?fbclid=123214adfe212">A</a>');
      expect(sel(document.querySelector('a')!)).toBe('a[href^="/page"]');
    });

    it('lops off a single random-hash query value', () => {
      setHTML('<a href="/dl?token=a8f3b9c2d1e7">A</a>');
      expect(sel(document.querySelector('a')!)).toBe('a[href^="/dl"]');
    });

    it('keeps a meaningful single-param query (exact match)', () => {
      setHTML('<a href="/blog?article=a-particular-article">A</a>');
      expect(sel(document.querySelector('a')!)).toBe(
        'a[href="/blog?article=a-particular-article"]',
      );
    });

    it('keeps a hash anchor (exact match)', () => {
      setHTML('<a href="/page#third-section">A</a>');
      expect(sel(document.querySelector('a')!)).toBe(
        'a[href="/page#third-section"]',
      );
    });

    it('collapses an over-long stable url to a boundary-anchored suffix', () => {
      // A meaningful single-param query we would otherwise embed whole (88
      // chars). The identity is at the tail, so anchor the suffix there rather
      // than record the shared category prefix.
      setHTML(
        '<a href="/product-category/drivhus-i-aluminium/?q=bredde-200cm/lengde-4m/vegg+og+tak-Polykarbonat">A</a>',
      );
      expect(sel(document.querySelector('a')!)).toBe(
        'a[href$="i-aluminium/?q=bredde-200cm/lengde-4m/vegg+og+tak-Polykarbonat"]',
      );
    });

    it('collapses an over-long stripped url to a base-path substring', () => {
      // The query is volatile (utm bundle) so the end can't be trusted; the
      // base path is still over budget, so match its distinctive tail as a
      // mid-string substring ahead of the query.
      setHTML(
        '<a href="/shop/category/garden-buildings/aluminium-greenhouses/traditional-range/model-drivhus-i-aluminium?utm_source=x&utm_medium=y">A</a>',
      );
      expect(sel(document.querySelector('a')!)).toBe(
        'a[href*="greenhouses/traditional-range/model-drivhus-i-aluminium"]',
      );
    });

    it('hard-truncates a boundaryless over-long tail', () => {
      setHTML(`<a href="/x?article=${'z'.repeat(90)}">A</a>`);
      expect(sel(document.querySelector('a')!)).toBe(
        `a[href$="${'z'.repeat(64)}"]`,
      );
    });

    it('never re-embeds a volatile query to disambiguate', () => {
      // Two links differ only by a per-visit fbclid. We must NOT lock onto the
      // throwaway token (it will change with each visit) collapse to the same
      // stripped prefix and the ambiguity is recorded as a match index instead.
      setHTML(`
        <a href="/p?fbclid=aaaa1111bbbb">One</a>
        <a href="/p?fbclid=cccc2222dddd" data-target="target">Two</a>
      `);
      const s = sel(target());
      expect(s).toBe('a[href^="/p"]');
      expect(s).not.toContain('fbclid');
      expect(matchCount(s)).toBe(2);
    });

    it('distinguishes two different links by their href', () => {
      setHTML(`
        <ul>
          <li><a href="/one">One</a></li>
          <li><a href="/two" data-target="target">Two</a></li>
        </ul>
      `);
      expect(expectResolves(target())).toBe('a[href="/two"]');
    });

    it('distinguishes identical hrefs by their container anchor', () => {
      setHTML(`
        <header><a href="/buy">Buy</a></header>
        <main><div class="cta"><a href="/buy" data-target="target">Buy</a></div></main>
      `);
      // The nearest identity ancestor `.cta` is kept as the container anchor; the
      // structural <main> is dropped and the descendant combinator bridges it.
      expect(expectResolves(target())).toBe('.cta a[href="/buy"]');
    });

    it('embeds an ancestor link href when clicking inner content', () => {
      setHTML('<a href="/deal"><span data-target="target">Buy</span></a>');
      const s = sel(target());
      // The <a> is an ancestor here, so its tag is stripped; the span terminal keeps its.
      expect(s).toContain('[href="/deal"]');
      expect(s).toContain('span');
    });

    it('pins a button to a preceding sibling id with +', () => {
      // The button has no id/class, but the span immediately before it carries
      // a stable id — the adjacent-sibling combinator pins them together
      // directly (tighter than hopping to the parent with :has).
      setHTML(`
        <section>
          <span id="sku-label">SKU 42</span>
          <button data-target="target">Buy</button>
        </section>
        <section>
          <button>Other</button>
        </section>
      `);
      expect(expectResolves(target())).toBe('span#sku-label + button');
    });

    it('pins a paragraph to a preceding heading id with +', () => {
      // The <p> has no identity, but the heading right before it carries a
      // stable id — the adjacent-sibling combinator pins them together.
      setHTML(`
        <article>
          <h1 id="just-released">Just released</h1>
          <p data-target="target">All the details.</p>
        </article>
        <article>
          <h1>Older</h1>
          <p>Other text.</p>
        </article>
      `);
      expect(expectResolves(target())).toBe('h1#just-released + p');
    });

    it('accepts a duplicated preceding-sibling id, leaving it to the match index', () => {
      // Malformed markup repeats #lbl, so `span#lbl + button` matches two
      // buttons. A sibling-id anchor embeds a stable id and stops the walk like
      // an own id — we no longer query the page to climb to a distinguishing
      // ancestor. The duplicate collapses; matchIndex/geometry resolve it.
      setHTML(`
        <div class="promo">
          <span id="lbl">Label</span>
          <button data-target="target">Buy</button>
        </div>
        <div class="sidebar">
          <span id="lbl">Label</span>
          <button>Buy</button>
        </div>
      `);
      expect(matchCount('#lbl')).toBe(2);
      const s = sel(target());
      expect(s).toBe('span#lbl + button');
      expect(matchCount(s)).toBe(2);
    });

    it('prefers a descendant :has anchor over a preceding-sibling +', () => {
      // The target has BOTH a stable id inside its subtree and a stable-id
      // sibling before it; :has wins because the id moves with the element.
      setHTML(`
        <section>
          <span id="before-label">Label</span>
          <div data-target="target"><i id="inside-anchor"></i></div>
        </section>
      `);
      const s = sel(target());
      // Direct child → the id is pinned one level down with `> #id`.
      expect(s).toContain(':has(> #inside-anchor)');
      expect(s).not.toContain('+');
    });

    it('does not use a preceding sibling whose id is unstable', () => {
      setHTML(`
        <div>
          <h2 id="ember123">Heading</h2>
          <p data-target="target">Body</p>
        </div>
      `);
      const s = sel(target());
      expect(s).not.toContain('ember123');
      expect(s).not.toContain('+');
      expect(s).toBe('p');
    });

    it('anchors via a descendant id with :has', () => {
      setHTML(`
        <ul>
          <li><p>nope</p></li>
          <li data-target="target"><p><i id="real-anchor"></i></p></li>
          <li><p>nope</p></li>
        </ul>
      `);
      const s = sel(target());
      // The id sits a level down (li > p > i), pinned as `> * > #id`.
      expect(s).toContain(':has(> * > #real-anchor)');
      expect(s).not.toContain('nth-of-type');
    });

    it('pins the :has to the id’s parent in a nested-div spine, not the whole spine', () => {
      // Faithful to the leightonvans.co.uk make-filter: an anonymous same-tag div
      // chain, the id-bearing <input> a direct child of the innermost div, and a
      // decoy icon <span> before the text <span> (which is why the sibling-id
      // anchor doesn't fire — the text span's previous sibling is the icon, not
      // the input). A loose `:has(#id)` matches every div on the spine, including
      // the outer container that also holds the BMW branch, so `:has(#id) span`
      // leaks across to the BMW spans. The `> #id` child combinator isolates the
      // one div that directly parents the id; the two spans that remain are the
      // same-container residual the caller resolves with match-index/geometry.
      setHTML(`
        <div class="filters">
          <div><div><input id="Volkswagen"><span class="ico"></span><span data-target="target">VW</span></div></div>
          <div><div><input id="BMW"><span class="ico"></span><span>BMW</span></div></div>
        </div>
      `);
      const s = sel(target());
      expect(s).toBe(':has(> #Volkswagen) span');
      const matches = Array.from(document.querySelectorAll(s));
      expect(matches.length).toBe(2); // both spans in the VW branch, none from BMW
      expect(matches).toContain(target());
      // The loose form the old code produced leaks across to the BMW branch:
      // .filters also matches `:has(#Volkswagen)` and holds all four spans.
      expect(matchCount(':has(#Volkswagen) span')).toBe(4);
    });

    it('pins a grandchild id with a `> * >` level path', () => {
      // The id is a grandchild of the anonymous <li> anchor (li > div > i), so
      // the path carries one wildcard level: `:has(> * > #id)`. It still isolates
      // the single <li>, keeping the target span unique.
      setHTML(`
        <ul>
          <li><div><i id="vw-badge"></i></div><span data-target="target">VW</span></li>
          <li><div><i id="bmw-badge"></i></div><span>BMW</span></li>
        </ul>
      `);
      const s = expectResolves(target());
      expect(s).toBe(':has(> * > #vw-badge) span');
    });

    it('ignores an id deeper than the depth cap and anchors elsewhere', () => {
      // #too-deep is three levels below the otherwise-anonymous wrapper div —
      // past MAX_HAS_ID_DEPTH — so it is not used as a :has anchor. The walk
      // climbs to the classed ancestor instead of emitting a fragile deep path.
      setHTML(`
        <section class="panel">
          <div><div><div><i id="too-deep"></i></div></div><span data-target="target">x</span></div>
        </section>
      `);
      const s = expectResolves(target());
      expect(s).not.toContain(':has');
      expect(s).not.toContain('too-deep');
      expect(s).toBe('.panel span');
    });

    it('skips data: URIs', () => {
      setHTML(
        '<div><img src="data:image/png;base64,AAAA" data-target="target"></div>',
      );
      expect(sel(target())).not.toContain('src=');
    });
  });
});
