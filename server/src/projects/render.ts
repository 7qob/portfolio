/**
 * block[] -> HTML. Pure functions, no Nest, no I/O.
 *
 * The output is a plain static page: style.css and script.js and nothing else,
 * works over file://, makes zero API calls. Every class emitted here already
 * exists in style.css; this file adds no CSS and expects none.
 *
 * Two languages: the chrome this file emits carries its German in data-de,
 * the same attribute the hand-written pages use and the same one script.js
 * swaps. What comes out of the database — headings, paragraphs, ledes, blurbs,
 * chips — is emitted in the language it was authored in and is not translated.
 *
 * Security stance: every author-supplied value passes through esc() first. The
 * only markup an author can produce is [text](url) and `code`, applied AFTER
 * escaping and with the href checked against SAFE_HREF. The one style attribute
 * is re-tested against the hex regex here rather than trusted from the record —
 * the DTO checked what arrived over HTTP, this checks what is about to reach a
 * public page, and there is a database between those two moments.
 */
import { ACCENT_HEX, Block, Chip, MediaBlock, SAFE_HREF, TextBlock } from './blocks';

export interface MediaRef {
  filename: string;
  originalName: string | null;
  mime: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
}

export type MediaLookup = (id: number) => MediaRef;

export interface PageProject {
  slug: string;
  title: string;
  status: string | null;
  /** The picture on the index row, already resolved. Null renders no rail. */
  cover: MediaRef | null;
  accent: string | null;
  homeSlot: string | null;
  repoUrl: string | null;
  lede: string | null;
  cardBlurb: string | null;
  chips: Chip[];
  blocks: Block[];
}

export interface Neighbour {
  slug: string;
  title: string;
}

export interface RenderOptions {
  assetPrefix?: string;
}

export const HOME_START = '<!-- projects:start -->';
export const HOME_END = '<!-- projects:end -->';

const ESC: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function esc(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ESC[c] ?? c);
}

export function inline(value: string): string {
  let out = esc(value);
  out = out.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  out = out.replace(/\[([^\]\n]+)\]\(([^()\s]+)\)/g, (match, label: string, href: string) => {
    if (!SAFE_HREF.test(href)) return match;
    const external = /^https?:\/\//i.test(href);
    return `<a href="${href}"${external ? ' target="_blank" rel="noopener"' : ''}>${label}</a>`;
  });
  return out;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB'];
  let value = bytes;
  let u = 0;
  while (value >= 1024 && u < units.length - 1) {
    value /= 1024;
    u++;
  }
  return (u > 0 && value < 10 ? value.toFixed(1) : String(Math.round(value))) + ' ' + units[u];
}

function indent(html: string, pad: string): string {
  return html
    .split('\n')
    .map((line) => (line ? pad + line : line))
    .join('\n');
}

const SVG_ATTRS =
  'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';

function svg(paths: string, size?: number): string {
  const dims = size ? ` width="${size}" height="${size}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg"${dims} ${SVG_ATTRS}>${paths}</svg>`;
}

export const CHIP_ICONS: Record<string, string> = {
  nodes:
    '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="10.5" x2="15.4" y2="6.5"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/>',
  image:
    '<rect x="3" y="3" width="18" height="18"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
  python:
    '<path d="M12.2 11.5H7.3A3.3 3.3 0 0 1 4 8.2V6.3A3.3 3.3 0 0 1 7.3 3h4.9a3.3 3.3 0 0 1 3.3 3.3v2.4"/><path d="M11.8 12.5h4.9a3.3 3.3 0 0 1 3.3 3.3v1.9a3.3 3.3 0 0 1-3.3 3.3h-4.9a3.3 3.3 0 0 1-3.3-3.3v-2.4"/><path d="M7.6 6.2h.01M16.4 17.8h.01"/>',
  rust: '<circle cx="12" cy="12" r="6.3"/><circle cx="12" cy="12" r="2.4"/><g stroke-width="2.6" stroke-linecap="butt"><path d="M12 5.7V2.5M12 18.3v3.2M5.7 12H2.5M18.3 12h3.2M7.55 7.55L5.28 5.28M16.45 16.45l2.27 2.27M16.45 7.55l2.27-2.27M7.55 16.45l-2.27 2.27"/></g>',
  proxy:
    '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
  stream: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  cloud: '<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>',
  react:
    '<circle cx="12" cy="12" r="2"/><ellipse cx="12" cy="12" rx="10" ry="4.2"/><ellipse cx="12" cy="12" rx="10" ry="4.2" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4.2" transform="rotate(120 12 12)"/>',
  typescript:
    '<rect x="2.5" y="2.5" width="19" height="19"/><g stroke-width="1.8"><path d="M6 12.4h6.4M9.2 12.4V19"/><path d="M19.9 13.6a2.1 2.1 0 0 0-3.5 1.5c0 1.9 3.5 1.2 3.5 3.1a2.1 2.1 0 0 1-3.5 1.4"/></g>',
  kobold:
    '<rect x="4" y="4" width="16" height="16"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/>',
  node: '<path d="M12 2l8.7 5v10L12 22l-8.7-5V7z"/>',
};

export const CHIP_ICON_NAMES: ReadonlySet<string> = new Set(Object.keys(CHIP_ICONS));

const ICON_MOON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

const ICON_EXTERNAL = svg('<line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/>', 13);

const ICON_CHEVRON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';

const ICON_BOX_ARROW =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';

const ICON_STAR = svg('<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>', 14);

const ICON_FOLDER = svg('<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>', 14);

const ICON_GITHUB = svg(
  '<path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>',
  20,
);

const ICON_USER = svg(
  '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  20,
);

/* The box arrow's twin: same size, pointing out of the page rather than into
   it. Both sit inside a span that is already aria-hidden. */
const ICON_BOX_ARROW_EXT =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>';

const CLIP_CONTROLS = `<button class="clip-btn clip-btn--play" type="button" data-clip-toggle aria-label="Pause clip">
  <span data-clip-icon="pause">
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="9" y1="4" x2="9" y2="20"/><line x1="15" y1="4" x2="15" y2="20"/></svg>
  </span>
  <span data-clip-icon="play" hidden>
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="6 4 20 12 6 20"/></svg>
  </span>
</button>
<button class="clip-btn clip-btn--full" type="button" data-clip-fullscreen aria-label="Fullscreen">
  <span data-clip-icon="enter">
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 3 3 3 3 9"/><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><polyline points="15 21 21 21 21 15"/></svg>
  </span>
  <span data-clip-icon="exit" hidden>
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 9 9 9 9 3"/><polyline points="21 9 15 9 15 3"/><polyline points="3 15 9 15 9 21"/><polyline points="21 15 15 15 15 21"/></svg>
  </span>
</button>
<div class="clip-track" data-clip-track aria-hidden="true"><span class="clip-track__fill" data-clip-fill></span></div>`;

const FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='16' fill='%23000'/%3E%3C/svg%3E";

/**
 * `titleDe` is the German title — the same data-de the hand-written pages put
 * on their own <title>. `desc` fills the description and the two Open Graph
 * lines from the page's own words rather than leaving them empty; it is not
 * translated, because a crawler reads the file, not the switched DOM.
 */
function head(
  title: string,
  ogType: string,
  p: string,
  meta: { titleDe?: string; desc?: string } = {},
): string {
  const de = meta.titleDe ? ` data-de="${esc(meta.titleDe)} · 7qob"` : '';
  const desc = meta.desc ? esc(meta.desc) : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title${de}>${esc(title)} · 7qob</title>
  <meta name="description" content="${desc}">

  <meta property="og:type" content="${ogType}">
  <meta property="og:title" content="${esc(title)} · 7qob">
  <meta property="og:description" content="${desc}">
  <meta property="og:image" content="">
  <meta property="og:url" content="">

  <link rel="icon" href="${FAVICON}">
  <link rel="stylesheet" href="${p}style.css">

  <!-- Saved theme, applied before first paint so a light visitor sees no flash. -->
  <script>
    try {
      if (localStorage.getItem("theme") === "light") {
        document.documentElement.classList.add("light");
      }
    } catch (e) {}
  </script>
</head>
<body>
`;
}

function header(p: string): string {
  return `  <header class="site-header">
    <a class="site-brand" href="${p}index.html" aria-label="7qob, home" data-de-label="7qob, Startseite">
      <span class="site-brand__name">7qob</span>
    </a>
    <nav class="site-nav" aria-label="Main" data-de-label="Hauptnavigation">
      <a href="${p}projects.html" aria-current="page" data-de="Projekte">Projects</a>
      <a href="${p}vault/index.html">Vault</a>
    </nav>
    <div class="site-controls">
      <button class="icon-btn" type="button" id="theme-toggle" aria-label="Toggle dark/bright" data-de-label="Hell/Dunkel umschalten" aria-pressed="false">
        <span data-theme-icon>
          ${ICON_MOON}
        </span>
      </button>
    </div>
  </header>
`;
}

function footer(p: string): string {
  return `  <footer class="site-footer">
    <span class="site-footer__meta">&copy; <span id="year"></span> 7qob &middot; v1.0.0</span>
    <a href="${p}impressum.html">Impressum</a>
    <a href="https://github.com/7qob" target="_blank" rel="noopener">GitHub<svg class="footer-arrow" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg></a>
  </footer>

  <script src="${p}script.js"></script>
</body>
</html>
`;
}

function chipList(chips: Chip[], pad: string): string {
  if (!chips.length) return '';
  const items = chips
    .map((c) => {
      const paths = c.icon ? CHIP_ICONS[c.icon] : undefined;
      const icon = paths ? svg(paths, 14) : '';
      return `  <li class="chip">${icon}${esc(c.label)}</li>`;
    })
    .join('\n');
  return indent(`<ul class="chips">\n${items}\n</ul>`, pad) + '\n';
}

function accentAttrs(accent: string | null): { cls: string; style: string } {
  if (!accent || !ACCENT_HEX.test(accent)) return { cls: '', style: '' };
  return { cls: ' is-custom', style: ` style="--edge-brand:${accent.toLowerCase()}"` };
}

function band(opts: {
  id: string;
  heading: string;
  inner: string;
  collapsible: boolean;
  hint?: string;
  hintDe?: string;
  bodyClass?: string;
}): string {
  if (!opts.collapsible) {
    return `      <section class="project__section" aria-labelledby="${opts.id}">
        <h2 class="section-label" id="${opts.id}">${esc(opts.heading)}</h2>
${indent(opts.inner, '        ')}
      </section>
`;
  }

  const de = opts.hintDe ? ` data-de="${opts.hintDe}"` : '';
  const hint = opts.hint
    ? `\n          <span class="reveal__hint"${de}>${opts.hint}</span>`
    : '';

  return `      <details class="reveal">
        <summary class="reveal__summary">
          <h2 class="section-label">${esc(opts.heading)}</h2>${hint}
          <span class="reveal__mark" aria-hidden="true">
            ${ICON_CHEVRON}
          </span>
        </summary>

        <div class="reveal__body${opts.bodyClass ?? ''}">
${indent(opts.inner, '          ')}
        </div>
      </details>
`;
}

function renderTextBand(b: TextBlock, id: string): string {
  return band({
    id,
    heading: b.heading,
    inner: b.body.map((par) => `<p>${inline(par)}</p>`).join('\n'),
    collapsible: b.collapsible,
    bodyClass: ' reading',
  });
}

function mediaSrc(m: MediaRef, p: string): string {
  return `${p}assets/up/${esc(m.filename)}`;
}

function dims(m: MediaRef): string {
  return m.width && m.height ? ` width="${m.width}" height="${m.height}"` : '';
}

function renderMediaBand(b: MediaBlock, id: string, media: MediaLookup, p: string): string {
  const totalBytes = b.rows.reduce((sum, r) => sum + media(r.mediaId).sizeBytes, 0);
  const n = b.rows.length;

  const rows = b.rows
    .map((row) => {
      const m = media(row.mediaId);
      const wide = row.layout === 'below' ? ' mediarow--wide' : '';
      const text = `  <div class="mediarow__text reading">
    <h3 class="mediarow__title">${esc(row.title)}</h3>
${row.body.map((par) => `    <p>${inline(par)}</p>`).join('\n')}
  </div>`;

      if (m.mime === 'video/mp4') {
        const frame = `<video class="mediarow__media" src="${mediaSrc(m, p)}"${dims(m)} autoplay loop muted playsinline preload="none" aria-label="${esc(row.alt)}"></video>
${CLIP_CONTROLS}`;
        return `<div class="mediarow${wide}">
  <div class="mediarow__frame">
${indent(frame, '    ')}
  </div>
${text}
</div>`;
      }

      return `<div class="mediarow${wide}">
  <img class="mediarow__media" src="${mediaSrc(m, p)}"${dims(m)} loading="lazy" decoding="async" alt="${esc(row.alt)}">
${text}
</div>`;
    })
    .join('\n\n');

  return band({
    id,
    heading: b.heading,
    inner: rows,
    collapsible: b.collapsible,
    hint: `${n} clip${n === 1 ? '' : 's'} &middot; ${formatBytes(totalBytes)}`,
    hintDe: `${n} Clip${n === 1 ? '' : 's'} &middot; ${formatBytes(totalBytes)}`,
  });
}

function renderBlock(b: Block, index: number, media: MediaLookup, p: string): string {
  const id = `lbl-b${index}`;
  return b.type === 'text' ? renderTextBand(b, id) : renderMediaBand(b, id, media, p);
}

function repoLink(url: string): string {
  const label = url.replace(/^https:\/\//i, '').replace(/\/+$/, '');
  return `    <nav class="linklist" aria-labelledby="lbl-repo">
      <h2 class="section-label" id="lbl-repo" data-de="Quellcode">Source</h2>
      <ul>
        <li>
          <a href="${esc(url)}" target="_blank" rel="noopener">
            <span class="linklist__label">${esc(label)}</span>
            ${ICON_EXTERNAL}
            <span class="linklist__note" data-de="Das Repository, das diese Seite beschreibt.">The repository this page describes.</span>
          </a>
        </li>
      </ul>
    </nav>
`;
}

export function renderProjectPage(
  project: PageProject,
  prev: Neighbour | null,
  next: Neighbour | null,
  media: MediaLookup,
  opts: RenderOptions = {},
): string {
  const p = opts.assetPrefix ?? '';

  /* Featured is the eyebrow's job now, so it is not also a badge on the name. */
  const status =
    project.status && project.status !== 'Featured'
      ? ` <span class="status">${esc(project.status)}</span>`
      : '';

  const eyebrow =
    project.status === 'Featured'
      ? `${ICON_STAR}<span data-de="Empfohlen">Featured</span>`
      : `${ICON_FOLDER}<span data-de="Projekt">Project</span>`;

  const accent = accentAttrs(project.accent);

  let html = head(project.title, 'article', p, {
    desc: project.lede ?? project.cardBlurb ?? undefined,
  });
  html += '\n';
  html += header(p);
  html += `
  <div class="page-head page-head--project${accent.cls}"${accent.style}>
    <p class="page-head__label">${eyebrow}</p>
    <h1 class="page-head__title" id="page-title">${esc(project.title)}${status}</h1>
${chipList(project.chips, '    ')}  </div>

  <main class="page-body page-body--project" aria-labelledby="page-title">
    <article class="project reading">

`;
  if (project.lede) {
    html += `      <p class="project__lede">${inline(project.lede)}</p>\n\n`;
  }

  html += project.blocks.map((b, i) => renderBlock(b, i, media, p)).join('\n');
  html += `
    </article>

`;

  if (project.repoUrl) html += repoLink(project.repoUrl);

  if (prev || next) {
    const prevLink = prev
      ? `      <a class="pager__prev" href="${p}project-${esc(prev.slug)}.html">
        <span class="pager__dir" data-de="&larr; Zurück">&larr; Previous</span>
        <span>${esc(prev.title)}</span>
      </a>\n`
      : '';
    const nextLink = next
      ? `      <a class="pager__next" href="${p}project-${esc(next.slug)}.html">
        <span class="pager__dir" data-de="Weiter &rarr;">Next &rarr;</span>
        <span>${esc(next.title)}</span>
      </a>\n`
      : '';
    html += `
    <nav class="pager" aria-label="More projects" data-de-label="Weitere Projekte">
${prevLink}${nextLink}    </nav>
`;
  }

  html += `  </main>

`;
  html += footer(p);
  return html;
}

/**
 * A row in the home page's project list.
 *
 * This is the single-page `.card`, not the old bento cell: an article with a
 * .shot rail on the left and head / desc / links on the right, matching the
 * hand-written cards in index.html tag for tag. The card carries no accent —
 * .card has no --edge-brand hook — so a project's colour shows on its own page
 * and on the projects index, not here.
 */
function projectCard(proj: PageProject, opts: { p: string }): string {
  const blurb = proj.cardBlurb ?? proj.lede ?? '';
  const tag = proj.status === 'WIP' ? `\n              <span class="tag">WIP</span>` : '';

  const desc = blurb ? `\n            <p class="card__desc">${inline(blurb)}</p>` : '';

  // Only a repo link, and only when there is one. The abstract PDFs on the
  // hand-written cards are not something the panel can produce.
  const repo =
    proj.repoUrl && SAFE_HREF.test(proj.repoUrl)
      ? `
            <div class="card__links">
              <a href="${esc(proj.repoUrl)}" target="_blank" rel="noopener">${ICON_GITHUB}source</a>
            </div>`
      : '';

  return `        <article class="card">
          <span class="shot shot--empty" data-label="${esc(proj.slug)}"></span>
          <div>
            <a class="card__head" href="${opts.p}project-${esc(proj.slug)}.html">
              <span class="card__name">${esc(proj.title)}</span>${tag}
            </a>${desc}${repo}
          </div>
        </article>`;
}

/**
 * A card on the projects index: the bento cell the home page renders, given a
 * cover and room to breathe. Same box, same rim, same arrow, same eyebrow and
 * chips in the same order, so the two indexes read as one system.
 *
 * The first project takes the feature card, which spans the row and stands its
 * cover beside the words — the same "first project is the large one" rule the
 * home page's cells follow.
 *
 * The cover is decorative: the card is already named by the stretched link, so
 * an alt repeating the title would only be read out twice. Under every cover
 * sits the plate, which shows through when a project has no picture yet or the
 * file behind one has gone missing.
 */
function projectIndexCard(proj: PageProject, p: string, feature: boolean): string {
  const accent = accentAttrs(proj.accent);
  const label =
    proj.status === 'Featured'
      ? `${ICON_STAR}<span data-de="Empfohlen">Featured</span>`
      : `${ICON_FOLDER}<span data-de="Projekt">Project</span>`;
  const wip = proj.status === 'WIP' ? `<span class="status">WIP</span>` : '';
  const blurb = proj.cardBlurb ?? proj.lede ?? '';
  const img = proj.cover
    ? `\n          <img src="${mediaSrc(proj.cover, p)}"${dims(proj.cover)}` +
      ` loading="lazy" decoding="async" alt="">`
    : '';
  const cls = `box box--link box--edge project-card${feature ? ' project-card--feature' : ''}${accent.cls}`;

  return `      <li class="${cls}"${accent.style}>
        <a class="stretched-link" href="${p}project-${esc(proj.slug)}.html" aria-label="${esc(proj.title)} project page" data-de-label="${esc(proj.title)} Projektseite"></a>
        <span class="project-card__shot">
          <span class="shot-plate">
            <span class="shot-plate__mark">${esc(proj.title)}</span>
            <span class="shot-plate__note" data-de="Screenshot folgt">Screenshot pending</span>
          </span>${img}
        </span>
        <div class="project-card__body">
          <span class="box-arrow" aria-hidden="true">
            ${ICON_BOX_ARROW}
          </span>
          <p class="box__label">${label}</p>
          <div class="project-card__head">
            <h2 class="project-card__name" id="p-${esc(proj.slug)}">${esc(proj.title)}</h2>${wip}
          </div>
          <p>${inline(blurb)}</p>
${chipList(proj.chips, '          ')}        </div>
      </li>`;
}

/** The two link boxes that close the index. */
function indexEndcap(p: string): string {
  return `    <section class="endcap" aria-labelledby="lbl-elsewhere">
      <h2 class="section-label" id="lbl-elsewhere" data-de="Anderswo">Elsewhere</h2>
      <div class="linkrow">

        <a class="link-box" href="https://github.com/7qob" target="_blank" rel="noopener">
          <span class="link-box__caption" data-de="Profil">Profile</span>
          <span class="link-box__label">
            <span class="link-box__icon" aria-hidden="true">
              ${ICON_GITHUB}
            </span>
            GitHub
          </span>
          <span class="link-box__note" data-de="Der Quellcode zu allem hier, plus die kleineren Sachen.">The source behind these, plus the smaller things.</span>
          <span class="box-arrow box-arrow--external" aria-hidden="true">
            ${ICON_BOX_ARROW_EXT}
          </span>
        </a>

        <a class="link-box" href="${p}index.html#about">
          <span class="link-box__caption" data-de="Kontext">Context</span>
          <span class="link-box__label">
            <span class="link-box__icon" aria-hidden="true">
              ${ICON_USER}
            </span>
            <span data-de="Über mich">About me</span>
          </span>
          <span class="link-box__note" data-de="Wer das hier baut, und warum diese Dinge.">Who builds these, and why these things.</span>
          <span class="box-arrow" aria-hidden="true">
            ${ICON_BOX_ARROW}
          </span>
        </a>

      </div>
    </section>
`;
}

export function renderProjectsIndex(projects: PageProject[], opts: RenderOptions = {}): string {
  const p = opts.assetPrefix ?? '';
  const cards = projects.map((proj, i) => projectIndexCard(proj, p, i === 0)).join('\n\n');

  let html = head('Projects', 'website', p, {
    titleDe: 'Projekte',
    desc: 'Tools, servers and experiments, mostly things I wanted for myself first.',
  });
  html += '\n';
  html += header(p);
  html += `
  <div class="page-head">
    <p class="page-head__label" data-de="Übersicht">Index</p>
    <h1 class="page-head__title" id="page-title" data-de="Projekte">Projects</h1>
    <p class="page-head__lede" data-de="Tools, Server und Experimente, meistens Dinge, die ich zuerst selbst haben wollte.">Tools, servers and experiments, mostly things I wanted for myself first.</p>
  </div>

  <main class="page-body" aria-labelledby="page-title">

    <ul class="project-grid">

${cards}

    </ul>

${indexEndcap(p)}  </main>

`;
  html += footer(p);
  return html;
}

/**
 * The home page is a splice, not a render: only the region between the two
 * markers and the data-projects count are rewritten. Everything else in
 * index.html is hand-written and never parsed.
 */
export function renderHome(template: string, projects: PageProject[], opts: RenderOptions = {}): string {
  const p = opts.assetPrefix ?? '';

  // A linear list, so the order the caller sorted them into is the whole of the
  // layout. home_slot still decides which projects are placed here and in what
  // order; it no longer names a grid cell, because there is no grid any more.
  const cards = projects.map((proj) => projectCard(proj, { p })).join('\n\n');

  return spliceRegion(
    template,
    HOME_START,
    HOME_END,
    cards ? `\n${cards}\n        ` : '\n        ',
    'the project cards',
  );
}

/**
 * Replace what lies between two markers, keeping the markers themselves.
 *
 * Both markers surviving is the whole trick: the output is a valid template for
 * the next splice, which is what lets index.html have more than one writer —
 * projects and sections each rewrite their own region and leave the other's
 * alone. Nothing here parses HTML. It is indexOf and two slices, so every byte
 * outside the region comes back unchanged.
 */
export function spliceRegion(
  template: string,
  startMarker: string,
  endMarker: string,
  body: string,
  what: string,
): string {
  const start = template.indexOf(startMarker);
  const end = template.indexOf(endMarker);

  if (start === -1 || end === -1 || end < start) {
    throw new Error(
      `The template has no ${startMarker} / ${endMarker} pair, so there is ` +
        `nowhere to write ${what}.`,
    );
  }

  return template.slice(0, start + startMarker.length) + body + template.slice(end);
}
