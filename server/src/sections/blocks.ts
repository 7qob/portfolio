/**
 * What a home-page section is made of, and the gate every payload passes.
 *
 * Deliberately not an extension of projects/blocks.ts. The two catalogues
 * render to different markup — a project page is bands, a home section is the
 * page's own prose — and sharing a type would only mean a renderer switch that
 * has to reject half its own input. What they do share is the shape of the
 * validation: hand-rolled, path-in-the-message errors, and a normaliser that
 * rebuilds a clean object rather than trusting the one it was handed.
 *
 * Every string is a pair. The site has a DE toggle, so an English paragraph
 * with no German twin is a real state (`de: ''`), not a missing field — see
 * the note on `data-de` in render.ts for what the twin costs.
 */
import { BlockError } from '../projects/blocks';

/** English is what the markup says; German is the attribute beside it. */
export interface Bilingual {
  en: string;
  de: string;
}

export interface SectionHeadingBlock {
  type: 'heading';
  text: Bilingual;
}

export interface SectionTextBlock {
  type: 'text';
  /** `.muted` — the grey lede the setup and readme sections open with. */
  muted: boolean;
  paragraphs: Bilingual[];
}

export type SectionBlock = SectionHeadingBlock | SectionTextBlock;

/**
 * The regions that exist, and the whole of the key alphabet.
 *
 * A fixed registry rather than free-form text, because every key has to match
 * a marker pair that a human put in index.html. A key that is not in this list
 * has nowhere to be written to, so it is a 400 rather than a row.
 */
export const SECTION_KEYS = ['top', 'about', 'setup', 'readme'] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export function isSectionKey(value: unknown): value is SectionKey {
  return typeof value === 'string' && (SECTION_KEYS as readonly string[]).includes(value);
}

const LIMITS = {
  blocks: 24,
  paragraphs: 40,
  paragraph: 4000,
  heading: 200,
};

function fail(at: string, why: string): never {
  throw new BlockError(`${at}: ${why}`);
}

function obj(value: unknown, at: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(at, 'expected an object');
  return value as Record<string, unknown>;
}

function arr(value: unknown, at: string, max: number): unknown[] {
  if (!Array.isArray(value)) fail(at, 'expected an array');
  if (value.length > max) fail(at, `at most ${max} entries`);
  return value;
}

/**
 * A bilingual string. English is required; German is optional and normalises
 * to '' rather than null, so the renderer has one thing to test and the editor
 * has one thing to put in a textarea.
 */
function pair(value: unknown, at: string, max: number, required: boolean): Bilingual {
  const o = obj(value, at);

  const en = typeof o.en === 'string' ? o.en.trim() : '';
  const de = typeof o.de === 'string' ? o.de.trim() : '';

  if (required && !en) fail(`${at}.en`, 'cannot be empty');
  if (en.length > max) fail(`${at}.en`, `at most ${max} characters`);
  if (de.length > max) fail(`${at}.de`, `at most ${max} characters`);

  return { en, de };
}

/** The gate. Rebuilds every block; an unknown type is a 400, never a passthrough. */
export function normalizeSectionBlocks(input: unknown): SectionBlock[] {
  const blocks = arr(input, 'blocks', LIMITS.blocks);

  return blocks.map((raw, i): SectionBlock => {
    const at = `blocks[${i}]`;
    const b = obj(raw, at);

    switch (b.type) {
      case 'heading':
        return { type: 'heading', text: pair(b.text, `${at}.text`, LIMITS.heading, true) };

      case 'text': {
        const paragraphs = arr(b.paragraphs, `${at}.paragraphs`, LIMITS.paragraphs)
          .map((p, n) => pair(p, `${at}.paragraphs[${n}]`, LIMITS.paragraph, false))
          // An empty English paragraph is a row the author cleared rather than
          // removed. Drop it instead of rendering an empty <p>.
          .filter((p) => p.en !== '');

        // Coerced, never a 400: a payload that omits the flag gets the default
        // rather than an error about a word it never typed.
        return { type: 'text', muted: b.muted === true, paragraphs };
      }

      default:
        return fail(`${at}.type`, `unknown block type ${JSON.stringify(b.type)}`);
    }
  });
}
