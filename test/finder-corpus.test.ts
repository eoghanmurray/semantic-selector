/**
 * Real-page corpus robustness test, adapted from antonmedv/finder's page suite.
 *
 * finder runs over every node of a real page and asserts each generated
 * selector is UNIQUE (querySelectorAll(css).length === 1). That invariant is
 * exactly what our identity-only model gives up (ambiguity is recorded as
 * matchIndex/matchCount, not forced into the selector), so we can't assert it.
 *
 * Instead we assert the weaker-but-essential SOUNDNESS invariant that must hold
 * that must hold over the same messy real HTML:
 *   - semanticSelector never throws on any element,
 *   - the result is a syntactically valid selector (querySelectorAll doesn't
 *     throw),
 *   - and the target element is always WITHIN the returned match set (our
 *     selector is a correct superset — it never excludes its own target).
 *
 * Fixtures: tests/fixtures/{deployer.org,github.com,stripe.com,tailwindcss}.html
 * (copied from finder's corpus).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { semanticSelector } from '../src/index';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// NB: this corpus runs on linkedom, not jsdom. The soundness invariant below
// requires a complete `:has()` engine, and jsdom's (nwsapi 2.2.0) silently
// returns 0 matches for an escaped-bracket id inside `:has()` and for two
// `:has()` in a single descendant chain — both of which our generator emits on
// real pages (github's `dd:has(#user\[login\])`, stripe's nested `:has()`).
// linkedom matches all of them correctly; happy-dom has no `:has()` at all.
const FIXTURES = [
  'deployer.org.html',
  'github.com.html',
  'stripe.com.html',
  'tailwindcss.html',
];

describe('finder real-page corpus (soundness invariant)', () => {
  let savedDocument: unknown;

  beforeAll(() => {
    savedDocument = (globalThis as Record<string, unknown>).document;
  });
  afterAll(() => {
    (globalThis as Record<string, unknown>).document = savedDocument;
  });

  for (const fixture of FIXTURES) {
    it(`generates sound selectors for every element in ${fixture}`, () => {
      const html = readFileSync(
        path.join(__dirname, 'fixtures', fixture),
        'utf8',
      );
      const { document: doc } = parseHTML(html);
      // semanticSelector consults the global `document` for its documentElement
      // stop-condition; point it at the fixture's document.
      (globalThis as Record<string, unknown>).document = doc;

      const body = doc.body;
      const elements = Array.from(body.querySelectorAll('*'));
      expect(elements.length).toBeGreaterThan(50); // sanity: real page loaded

      let ambiguous = 0;
      for (const el of elements) {
        let selectorStr: string;
        try {
          selectorStr = semanticSelector(el, body);
        } catch (err) {
          throw new Error(
            `semanticSelector threw on <${el.tagName.toLowerCase()}>: ${String(
              err,
            )}`,
          );
        }
        expect(selectorStr, 'selector should be non-empty').toBeTruthy();

        let matches: ArrayLike<Element>;
        try {
          matches = body.querySelectorAll(selectorStr);
        } catch (err) {
          throw new Error(
            `invalid selector "${selectorStr}" for <${el.tagName.toLowerCase()}>: ${String(
              err,
            )}`,
          );
        }

        // Soundness: the element must be among its own selector's matches.
        expect(
          Array.prototype.indexOf.call(matches, el) >= 0,
          `selector "${selectorStr}" did not match its own target <${el.tagName.toLowerCase()}>`,
        ).toBe(true);

        if (matches.length > 1) ambiguous++;
      }

      // Not an assertion on a magic number — just a guard that the corpus is
      // exercising both the unique and the ambiguous (matchIndex) code paths.
      expect(ambiguous).toBeGreaterThan(0);
      expect(ambiguous).toBeLessThan(elements.length);
    });
  }
});
