import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { esc, inline } from './render';

/**
 * These two functions are the whole boundary between the admin form and a
 * published page. Everything an author types passes through `esc`, and the
 * only markup that survives is the `[text](url)` and `` `code` `` that
 * `inline` puts back afterwards, with the href checked against an allowlist.
 *
 * So these are not "utility function" tests. If one of them regresses, the
 * panel becomes a stored-XSS injector into a static file that is then served
 * to everyone, and nothing else in the stack is looking.
 */

describe('esc', () => {
  it('escapes the five characters that matter', () => {
    assert.equal(esc('&<>"\''), '&amp;&lt;&gt;&quot;&#39;');
  });

  /**
   * The ampersand has to be replaced in the same pass as the rest, not in a
   * pass before it, or every later substitution is escaped a second time and
   * `<` arrives on the page as the literal text `&amp;lt;`.
   */
  it('does not double-escape its own output markers', () => {
    assert.equal(esc('<'), '&lt;');
    assert.equal(esc('a & b < c'), 'a &amp; b &lt; c');
  });

  it('defuses a script tag', () => {
    assert.equal(
      esc('<script>alert(1)</script>'),
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
  });

  it('leaves ordinary prose alone', () => {
    assert.equal(esc('A sentence, with punctuation: and a dash.'),
                 'A sentence, with punctuation: and a dash.');
  });
});

describe('inline', () => {
  it('makes an external link, marked noopener', () => {
    assert.equal(
      inline('see [the repo](https://github.com/7qob/x)'),
      'see <a href="https://github.com/7qob/x" target="_blank" rel="noopener">the repo</a>',
    );
  });

  it('makes an internal link without a new tab', () => {
    assert.equal(inline('[the vault](/vault/)'), '<a href="/vault/">the vault</a>');
    assert.equal(inline('[about](about.html)'), '<a href="about.html">about</a>');
    assert.equal(inline('[top](#lbl-top)'), '<a href="#lbl-top">top</a>');
  });

  it('refuses javascript: and leaves the text standing', () => {
    const out = inline('[click me](javascript:alert(1))');
    assert.ok(!out.includes('<a'), 'no anchor was produced');
    assert.ok(!out.includes('javascript:alert(1)') || !out.includes('href'),
              'and certainly no href');
  });

  it('refuses data: and vbscript:', () => {
    for (const href of ['data:text/html;base64,PHNjcmlwdD4=', 'vbscript:msgbox']) {
      assert.ok(!inline(`[x](${href})`).includes('<a'), `${href} must not become a link`);
    }
  });

  /**
   * `//evil.com` is a protocol-relative URL: it looks like a path and is not
   * one. It read as internal to the old allowlist, which is what the negative
   * lookahead in SAFE_HREF now stops.
   */
  it('refuses a protocol-relative host', () => {
    assert.ok(!inline('[x](//evil.com/phish)').includes('<a'));
  });

  /**
   * The href is taken from the already-escaped string, so a quote in the
   * original cannot close the attribute. This asserts the ordering, which is
   * the part that is easy to break while refactoring.
   */
  it('cannot be broken out of the href attribute', () => {
    const out = inline('[x](https://e.com/"onmouseover="alert(1))');
    assert.ok(!out.includes('onmouseover="alert(1)"'), 'no attribute was smuggled in');
    assert.ok(!out.includes('"o'), 'the quote did not survive as a quote');
  });

  it('escapes the label before using it', () => {
    const out = inline('[<img src=x onerror=alert(1)>](https://e.com)');
    assert.ok(out.includes('&lt;img'), 'the label is escaped');
    assert.ok(!out.includes('<img'), 'and no tag reaches the page');
  });

  it('escapes inside code spans too', () => {
    assert.equal(inline('use `<div>` here'), 'use <code>&lt;div&gt;</code> here');
  });

  it('leaves an unclosed or malformed link as plain text', () => {
    assert.equal(inline('[half open](https://e.com'), '[half open](https://e.com');
    assert.equal(inline('not a [link] at all'), 'not a [link] at all');
  });

  it('leaves prose with brackets and backticks in it readable', () => {
    assert.equal(inline('an array[0] and a tick'), 'an array[0] and a tick');
  });
});
