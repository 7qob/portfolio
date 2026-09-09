/**
 * A home-page section, as markup.
 *
 * The output is ordinary static HTML that style.css already styles and
 * script.js already animates — no class here is new. What comes out is spliced
 * between the section's two markers in index.html and is the whole of what the
 * visitor's browser gets; nothing on the published page calls the API.
 *
 * Everything author-supplied goes through esc() or inline() from the projects
 * renderer. Same reasoning as there: the DTO checked what arrived over HTTP,
 * this checks what is about to reach a public page, and there is a database
 * between those two moments.
 */
import { esc, inline } from '../projects/render';
import { Bilingual, SectionBlock, SectionKey } from './blocks';

export const sectionStart = (key: string): string => `<!-- section:${key}:start -->`;
export const sectionEnd = (key: string): string => `<!-- section:${key}:end -->`;

/**
 * The German twin.
 *
 * applyLang() in script.js swaps innerHTML and remembers the English in an
 * `el.langEn` property, so the English side may carry the `code` / [label](url)
 * mini-markdown and still survive a round trip through German and back. The
 * German side stays plain text, the same convention the projects renderer and
 * the hand-written pages already follow — it lives in an attribute, and markup
 * in an attribute is a quoting problem nobody needs.
 */
function bilingual(value: Bilingual): { html: string; attr: string } {
  return {
    html: inline(value.en),
    attr: value.de ? ` data-de="${esc(value.de)}"` : '',
  };
}

function renderBlock(block: SectionBlock, pad: string): string {
  switch (block.type) {
    case 'heading': {
      const { html, attr } = bilingual(block.text);
      return `${pad}<h1 class="hero__title"${attr}>${html}</h1>`;
    }

    case 'text': {
      const cls = block.muted ? ' class="muted"' : '';
      const paragraphs = block.paragraphs
        .map((p) => {
          const { html, attr } = bilingual(p);
          return `${pad}  <p${cls}${attr}>${html}</p>`;
        })
        .join('\n');

      return `${pad}<div class="prose">\n${paragraphs}\n${pad}</div>`;
    }
  }
}

/**
 * One region, wrapper and all.
 *
 * The wrapper is not decoration: it is the handle edit.js grabs to swap a
 * section for its form and back again, which beats walking to a comment node.
 * It is a bare <div> on purpose — every rule that applies inside a section
 * (.prose p, .facts, .fold) is a descendant selector, so an extra level of
 * nesting changes nothing.
 */
export function renderSection(key: SectionKey, blocks: SectionBlock[], pad = '        '): string {
  const body = blocks.map((b) => renderBlock(b, `${pad}  `)).join('\n');

  return `${pad}<div class="region" data-region="${esc(key)}">\n${body}\n${pad}</div>`;
}
