/**
 * The block format: what a project's body is made of, and the gate every
 * incoming payload passes before it is stored.
 *
 * There are two block types and there is no third. A project page is a
 * description, some words and some pictures — the numbered steps, feature
 * lists, tables, facts strip and downloads list that used to live here were
 * catalogue entries nobody reached for, and every one of them was a shape the
 * editor had to offer and the renderer had to keep working. Both surviving
 * types map 1:1 onto markup style.css already carries.
 *
 * Nothing here renders; normalising is a separate concern from emitting HTML
 * (render.ts) so that a record read back from the database is already known to
 * be well-formed.
 *
 * Validation is hand-rolled rather than class-validator because the payload
 * is a discriminated union three levels deep, which decorators express badly
 * and error-message quality matters here: the author is a human in a form,
 * and "blocks[3].rows[1].alt must be a string" is actionable where a bare
 * 400 is not.
 */

/**
 * A band of prose. `collapsible` is the one presentational choice an author
 * makes about it: false renders a plain <section>, true wraps the same words
 * in the site's closed <details>.
 */
export interface TextBlock {
  type: 'text';
  heading: string;
  body: string[];
  collapsible: boolean;
}

/**
 * `layout` replaces the old `wide` boolean, because it is a choice between
 * two shapes rather than a flag: 'beside' puts the words next to the picture
 * (.mediarow), 'below' puts them under it (.mediarow--wide).
 */
export interface MediaRow {
  mediaId: number;
  alt: string;
  title: string;
  body: string[];
  layout: 'beside' | 'below';
}

export interface MediaBlock {
  type: 'media';
  heading: string;
  collapsible: boolean;
  rows: MediaRow[];
}

export type Block = TextBlock | MediaBlock;

export interface Chip {
  label: string;
  icon: string | null;
}

/** Raised on any malformed payload; the service maps it to a 400. */
export class BlockError extends Error {}

/**
 * Only these schemes and shapes may become an href. Everything else stays
 * literal text, so a stored payload can never smuggle javascript: into a
 * generated page.
 *
 * The `\/(?!\/)` is not a typo. A bare `\/` also admits `//evil.com`, which a
 * browser reads as a protocol-relative URL to another host, not as a path on
 * this site: the link would look internal in the panel and leave the site
 * when clicked. Root-relative means one slash.
 */
export const SAFE_HREF = /^(https?:\/\/|\/(?!\/)|#|[a-z0-9][a-z0-9._-]*\.html)/i;

/** The repo link is the one href an author gives directly, and it is a repo. */
export const GITHUB_URL = /^https:\/\/github\.com\/[A-Za-z0-9._\-/#?=&%]{1,180}$/;

/** The one thing that crosses from the form into a style attribute. */
export const ACCENT_HEX = /^#[0-9a-fA-F]{6}$/;

/** The four cells of the home bento a project can occupy. */
export const HOME_SLOTS = ['feature', 'tall', 'smallA', 'smallB'] as const;
export type HomeSlot = (typeof HOME_SLOTS)[number];

// ---------------------------------------------------------------------------
// Primitive checks. `at` names the offending field in the error, path-style.
// ---------------------------------------------------------------------------

const LIMITS = {
  blocks: 64,
  heading: 120,
  paragraph: 4000,
  items: 60,
  chips: 10,
} as const;

function fail(at: string, why: string): never {
  throw new BlockError(`${at}: ${why}`);
}

function obj(v: unknown, at: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(at, 'must be an object');
  return v as Record<string, unknown>;
}

function arr(v: unknown, at: string, max: number): unknown[] {
  if (!Array.isArray(v)) fail(at, 'must be an array');
  if (v.length > max) fail(at, `too long (max ${max})`);
  return v;
}

function str(v: unknown, at: string, max: number): string {
  if (typeof v !== 'string') fail(at, 'must be a string');
  const out = v.trim();
  if (!out) fail(at, 'must not be empty');
  if (out.length > max) fail(at, `too long (max ${max} characters)`);
  return out;
}

function optStr(v: unknown, at: string, max: number): string | null {
  if (v === undefined || v === null || v === '') return null;
  return str(v, at, max);
}

function mediaId(v: unknown, at: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) {
    fail(at, 'must reference an uploaded file');
  }
  return v;
}

function paragraphs(v: unknown, at: string): string[] {
  return arr(v, at, LIMITS.items).map((p, i) => str(p, `${at}[${i}]`, LIMITS.paragraph));
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

export function normalizeBlocks(input: unknown): Block[] {
  const list = arr(input, 'blocks', LIMITS.blocks);

  return list.map((raw, i) => {
    const at = `blocks[${i}]`;
    const b = obj(raw, at);

    switch (b.type) {
      case 'text':
        return {
          type: 'text',
          heading: str(b.heading, `${at}.heading`, LIMITS.heading),
          body: paragraphs(b.body, `${at}.body`),
          collapsible: b.collapsible === true,
        } satisfies TextBlock;

      case 'media':
        return {
          type: 'media',
          heading: str(b.heading, `${at}.heading`, LIMITS.heading),
          collapsible: b.collapsible === true,
          rows: arr(b.rows, `${at}.rows`, LIMITS.items).map((row, j) => {
            const o = obj(row, `${at}.rows[${j}]`);
            return {
              mediaId: mediaId(o.mediaId, `${at}.rows[${j}].mediaId`),
              alt: str(o.alt, `${at}.rows[${j}].alt`, LIMITS.paragraph),
              title: str(o.title, `${at}.rows[${j}].title`, LIMITS.heading),
              body: paragraphs(o.body, `${at}.rows[${j}].body`),
              // Anything that is not the wide shape is the ordinary one, so a
              // payload that omits the field gets the image default rather
              // than a 400 about a word it never typed.
              layout: o.layout === 'below' ? 'below' : 'beside',
            };
          }),
        } satisfies MediaBlock;

      default:
        fail(`${at}.type`, `unknown block type "${String(b.type)}"`);
    }
  });
}

/** Chip icons come from the renderer's own catalogue, never from the form. */
export function normalizeChips(input: unknown, iconNames: ReadonlySet<string>): Chip[] {
  return arr(input, 'chips', LIMITS.chips).map((raw, i) => {
    const o = obj(raw, `chips[${i}]`);
    const icon = optStr(o.icon, `chips[${i}].icon`, 40);
    if (icon !== null && !iconNames.has(icon)) {
      fail(`chips[${i}].icon`, `unknown icon "${icon}"`);
    }
    return { label: str(o.label, `chips[${i}].label`, 60), icon };
  });
}

/** Every media id a page depends on — publish refuses if any is missing. */
export function collectMediaIds(blocks: Block[]): number[] {
  const ids = new Set<number>();
  for (const b of blocks) {
    if (b.type === 'media') b.rows.forEach((r) => ids.add(r.mediaId));
  }
  return [...ids];
}
