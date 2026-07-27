/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { stableSelector } from '../src/index';

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
  const s = stableSelector(el, root);
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

describe('stableSelector', () => {
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

    it('climbs past a DUPLICATED own id to anchor on the duplicate ancestor', () => {
      // Real-world malformed markup: the same id appears twice, inner nested
      // under outer. The own id no longer uniquely stops the walk, so the
      // selector gains the ancestor #content-wrapper and resolves to the inner
      // one only — instead of '#content-wrapper' + selectorMatchIndex 2-of-2.
      setHTML(`
        <div id="content-wrapper" class="js-content-wrapper">
          <div class="row">
            <div id="content-wrapper" class="left-column col-md-9" data-target="target">x</div>
          </div>
        </div>
      `);
      expect(matchCount('#content-wrapper')).toBe(2);
      // Ancestors are tag-stripped; only the terminal (inner) keeps its tag.
      expect(expectResolves(target())).toBe(
        '#content-wrapper .row div#content-wrapper',
      );
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
  // Weak (CMS-enumerated) IDs — block-12 style: a hint, not a handle.
  // Included only when the weak-id-free selector is otherwise ambiguous;
  // they never stop the upward walk.
  // -------------------------------------------------------------------

  describe('weak IDs (block-12 style)', () => {
    it('drops a weak id when the element is already unique without it', () => {
      setHTML(
        '<section><div id="block-12" data-target="target">x</div></section>',
      );
      const s = sel(target());
      expect(s).toBe('div');
      expect(s).not.toContain('block-12');
      expect(matchCount(s)).toBe(1);
    });

    it("prefers the element's stable class over its weak id", () => {
      setHTML('<div class="hero" id="block-12" data-target="target">x</div>');
      const s = sel(target());
      expect(s).toBe('div.hero');
      expect(s).not.toContain('block-12');
    });

    it('folds the weak id in (with the class) to disambiguate siblings', () => {
      setHTML(`
        <div class="block" id="block-7">a</div>
        <div class="block" id="block-12" data-target="target">b</div>
      `);
      const s = sel(target());
      expect(s).toBe('div.block#block-12');
      expect(matchCount(s)).toBe(1);
    });

    it('falls back to the bare weak id when nothing else disambiguates', () => {
      setHTML(`
        <div id="block-7">a</div>
        <div id="block-12" data-target="target">b</div>
      `);
      const s = sel(target());
      expect(s).toBe('div#block-12');
      expect(matchCount(s)).toBe(1);
    });

    it('does not stop the walk on a weak id — keeps climbing for context', () => {
      setHTML(`
        <div id="main">
          <div id="block-12">
            <a href="/buy" data-target="target">Buy</a>
          </div>
        </div>
      `);
      // The strong #main ancestor still anchors the selector, proving the walk
      // climbed past the interior weak #block-12 (which is itself omitted as
      // the href already resolves uniquely).
      const s = sel(target());
      expect(s).toBe('#main a[href="/buy"]');
      expect(s).not.toContain('block-12');
    });

    it('treats a separator-less trailing-number id (heading2) as strong', () => {
      setHTML('<div id="section2" data-target="target">x</div>');
      expect(sel(target())).toBe('div#section2');
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

    it('prefers a stable class over a weak semantic attribute (aria-label)', () => {
      setHTML(
        '<div class="hero" aria-label="Hero banner" data-target="target">x</div>',
      );
      const s = sel(target());
      expect(s).toBe('div.hero');
      expect(s).not.toContain('aria-label=');
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
      expect(s).toBe('.product-grid .product-card button');
      // Three identical cards — ambiguity resolved by matchIndex, not the string.
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
      // href wins over the cta-button class on the anchor; the hero section's
      // stable class is still recorded as an identity-rich (tag-stripped) ancestor.
      expect(s).toBe('.hero a[href="/signup"]');
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
      const s = stableSelector(el, document.body);
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
      const s = stableSelector(child, document.body);
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

    it('disambiguates identical hrefs in different structural positions', () => {
      setHTML(`
        <header><a href="/buy">Buy</a></header>
        <main><div class="cta"><a href="/buy" data-target="target">Buy</a></div></main>
      `);
      // The href is kept and a stable-class ancestor (.cta) disambiguates;
      // the structural <main> is dropped, descendant combinator bridges it.
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

    it('climbs past a DUPLICATED preceding-sibling id to disambiguate', () => {
      // Malformed markup repeats #lbl, so `span#lbl + button` is a stop that
      // actually matches two buttons. The duplicate-id rescue must treat the
      // sibling-anchor id like a duplicated own-id: keep the segment but climb
      // to the distinguishing ancestor (div.promo) rather than stopping.
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
      expect(matchCount('span#lbl + button')).toBe(2);
      // Ancestor .promo is tag-stripped; the terminal sibling-anchor keeps its
      // tags (span#lbl anchors the trailing button the combinator needs).
      expect(expectResolves(target())).toBe('.promo span#lbl + button');
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
      expect(s).toContain(':has(#inside-anchor)');
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
      expect(s).toContain(':has(#real-anchor)');
      expect(s).not.toContain('nth-of-type');
    });

    it('skips data: URIs', () => {
      setHTML(
        '<div><img src="data:image/png;base64,AAAA" data-target="target"></div>',
      );
      expect(sel(target())).not.toContain('src=');
    });
  });
});
