/**
 * @vitest-environment jsdom
 *
 * Divergence tests vs antonmedv/finder.
 *
 * finder generates the shortest selector that is UNIQUE against the current
 * document, falling through tag -> :nth-of-type -> :nth-child until exactly one
 * node matches. Our generator is identity-only: it emits just the stable,
 * intrinsic parts of the path and records residual ambiguity out-of-band as
 * selectorMatchIndex/selectorMatchCount, never baking position into the string.
 *
 * These tests pin the points where our output deliberately differs from
 * finder's, using finder's own fixtures where it has them.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { semanticSelector } from '../src/index';

function setHTML(html: string) {
  document.body.innerHTML = html;
}
function matchCount(s: string): number {
  return document.body.querySelectorAll(s).length;
}

describe('divergence from finder', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  // finder test: 'duplicate'
  it('keeps a duplicated id and leaves disambiguation to matchIndex', () => {
    // finder: a non-unique #foo is unusable, so it falls back to nth-of-type.
    // us: #foo is a valid identity anchor; both divs collapse to "div#foo" and
    // the 1-of-2 / 2-of-2 position is recorded separately, not in the string.
    setHTML('<div id="foo"></div><div id="foo"></div>');
    const divs = document.body.querySelectorAll('div');
    expect(semanticSelector(divs[0])).toBe('div#foo');
    expect(semanticSelector(divs[1])).toBe('div#foo');
    expect(matchCount('div#foo')).toBe(2);
  });

  // finder test: 'duplicate:sub-nodes'
  it('walks through a duplicated id without nth-of-type', () => {
    setHTML('<div id="foo"><i></i></div><div id="foo"><i></i></div>');
    const i = document.body.querySelector('i')!;
    const s = semanticSelector(i);
    // <i> is a non-container tag: it keeps the descendant combinator (a `>` an
    // inserted wrapper would break isn't worth it — <i> barely nests). Both
    // duplicate #foo divs contain an <i>, so it still matches 2.
    expect(s).toBe('#foo i');
    expect(s).not.toContain('nth-of-type');
    expect(matchCount(s)).toBe(2);
  });

  // finder test: 'bad-class-names'
  it('drops emotion-style hashed classes, leaving a root-scoped bare tag', () => {
    // finder rejects these via wordLike (they contain digits); so do we via the
    // css- prefix rule. Both end up with no class — but finder then appends a
    // positional ordinal to stay unique, whereas we accept the ambiguity. Being
    // a bare tag directly under the root, it is scoped to the root's children
    // (`:scope > div`); both hashed divs are direct children, so it matches 2.
    setHTML('<div class="css-175oi2r"></div><div class="css-y6a5a9i"></div>');
    const divs = document.body.querySelectorAll('div');
    const s = semanticSelector(divs[0]);
    expect(s).toBe(':scope > div');
    expect(s).not.toContain('css-');
    expect(matchCount(s)).toBe(2);
  });

  it('anchors a purely-numeric id that finder would reject', () => {
    // finder's idName=wordLike rejects ANY id containing a digit, so a numeric
    // DB row id gets thrown away in favour of nth-of-type. We treat it as a
    // stable [id="..."] anchor (finder forks PR #69).
    setHTML('<div id="12345"><span>x</span></div>');
    const span = document.body.querySelector('span')!;
    // Bare <span> (a container tag), immediate parent the id'd div → pinned as
    // its direct child.
    expect(semanticSelector(span)).toBe('[id="12345"] > span');
  });

  it('never emits a positional ordinal for identity-less siblings', () => {
    // The canonical finder output here is "div:nth-of-type(3)". We refuse to
    // encode position; all three collapse to "div".
    setHTML('<main><div>a</div><div>b</div><div>c</div></main>');
    const last = document.body.querySelectorAll('div')[2];
    const s = semanticSelector(last);
    expect(s).toBe('div');
    expect(s).not.toContain('nth-');
    expect(matchCount(s)).toBe(3);
  });

  it('converges with finder on semantic attributes (name)', () => {
    // Previously a gap; now both use the name attribute as an anchor.
    setHTML('<form><input><button name="checkout-submit">Pay</button></form>');
    const btn = document.body.querySelector('button')!;
    expect(semanticSelector(btn)).toBe('button[name="checkout-submit"]');
  });
});
