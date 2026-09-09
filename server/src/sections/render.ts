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
import { esc, inline, MediaLookup, MediaRef } from '../projects/render';
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

/**
 * A picture with its words under it: the `.rig--solo` figure, which is the
 * shape the hand-written Pi block already had. `--solo` is what stops it being
 * a one-column grid, and the picture fills the column rather than sitting at
 * its native width with its right edge lining up with nothing.
 */
function renderMedia(
  block: Extract<SectionBlock, { type: 'media' }>,
  pad: string,
  media: MediaLookup,
  p: string,
): string {
  const m: MediaRef = media(block.mediaId);
  const size = m.width && m.height ? ` width="${m.width}" height="${m.height}"` : '';
  const name = bilingual(block.name);

  const words = block.paragraphs.map((q) => {
    const { html, attr } = bilingual(q);
    return `${pad}      <p${attr}>${html}</p>`;
  });

  const caption: string[] = [];
  if (block.name.en || words.length) {
    caption.push(`${pad}    <figcaption class="rig__text">`);
    if (block.name.en) {
      caption.push(`${pad}      <b class="rig__name"${name.attr}>${name.html}</b>`);
    }
    caption.push(...words);
    caption.push(`${pad}    </figcaption>`);
  }

  return [
    `${pad}<div class="rig rig--solo">`,
    `${pad}  <figure class="rig__row">`,
    `${pad}    <img class="rig__media" src="${p}assets/up/${esc(m.filename)}"${size}` +
      ` loading="lazy" decoding="async" alt="${esc(block.alt)}">`,
    ...caption,
    `${pad}  </figure>`,
    `${pad}</div>`,
  ].join('\n');
}

function renderBlock(block: SectionBlock, pad: string, media: MediaLookup, p: string): string {
  switch (block.type) {
    case 'heading': {
      const { html, attr } = bilingual(block.text);
      return `${pad}<h1 class="hero__title"${attr}>${html}</h1>`;
    }

    case 'text': {
      const cls = block.muted ? ' class="muted"' : '';
      const paragraphs = block.paragraphs
        .map((q) => {
          const { html, attr } = bilingual(q);
          return `${pad}  <p${cls}${attr}>${html}</p>`;
        })
        .join('\n');

      return `${pad}<div class="prose">\n${paragraphs}\n${pad}</div>`;
    }

    case 'media':
      return renderMedia(block, pad, media, p);
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
export function renderSection(
  key: SectionKey,
  blocks: SectionBlock[],
  media: MediaLookup,
  pad = '        ',
  p = '',
): string {
  const body = blocks.map((b) => renderBlock(b, `${pad}  `, media, p)).join('\n');

  return `${pad}<div class="region" data-region="${esc(key)}">\n${body}\n${pad}</div>`;
}
