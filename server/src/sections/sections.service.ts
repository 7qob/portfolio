import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import { DatabaseService } from '../db/database.service';
import { BlockError } from '../projects/blocks';
import { MediaLookup, MediaRef, spliceRegion } from '../projects/render';
import { ensurePagesDir, homeTemplate, writePage } from '../site/pages';
import { normalizeSectionBlocks, SECTION_KEYS, SectionBlock, SectionKey } from './blocks';
import { renderSection, sectionEnd, sectionStart } from './render';

interface MediaRow {
  id: number;
  filename: string;
  original_name: string | null;
  mime: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
}

interface SectionRow {
  key: string;
  draft_blocks: string;
  live_blocks: string | null;
  updated_at: string;
  published_at: string | null;
}

@Injectable()
export class SectionsService {
  private readonly logger = new Logger(SectionsService.name);

  constructor(private readonly database: DatabaseService) {
    ensurePagesDir();
  }

  // -------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------

  /**
   * Every key in the registry, whether or not it has a row yet. The pens are
   * drawn from this, and a section nobody has touched still needs one — the
   * first edit is what creates the row.
   */
  list() {
    const rows = new Map(
      (this.database.db.prepare(`SELECT * FROM sections`).all() as SectionRow[]).map((r) => [
        r.key,
        r,
      ]),
    );

    return {
      rows: SECTION_KEYS.map((key) => {
        const row = rows.get(key);
        return {
          key,
          hasDraft: row ? row.draft_blocks !== (row.live_blocks ?? '[]') : false,
          published: row?.live_blocks != null,
          publishedAt: row?.published_at ?? null,
          updatedAt: row?.updated_at ?? null,
        };
      }),
    };
  }

  get(key: SectionKey) {
    const row = this.database.db.prepare(`SELECT * FROM sections WHERE key = ?`).get(key) as
      | SectionRow
      | undefined;

    return {
      key,
      // No row is not an error: it means the region is still the markup that
      // shipped in index.html, and the editor seeds itself from the page.
      blocks: row ? (JSON.parse(row.draft_blocks) as SectionBlock[]) : [],
      published: row?.live_blocks != null,
      publishedAt: row?.published_at ?? null,
    };
  }

  // -------------------------------------------------------------------------
  // Writing
  // -------------------------------------------------------------------------

  /** Saves the draft and nothing else. The live page is untouched until publish. */
  save(key: SectionKey, input: unknown): void {
    let blocks: SectionBlock[];
    try {
      blocks = normalizeSectionBlocks(input);
    } catch (err) {
      if (err instanceof BlockError) throw new BadRequestException(err.message);
      throw err;
    }

    this.database.db
      .prepare(
        `INSERT INTO sections (key, draft_blocks, updated_at)
              VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE
                SET draft_blocks = excluded.draft_blocks,
                    updated_at   = datetime('now')`,
      )
      .run(key, JSON.stringify(blocks));
  }

  publish(key: SectionKey): void {
    const row = this.database.db.prepare(`SELECT * FROM sections WHERE key = ?`).get(key) as
      | SectionRow
      | undefined;

    if (!row) throw new BadRequestException('Nothing has been written for that section yet.');

    // Re-validate on the way out. The DTO checked what arrived over HTTP; this
    // checks what is about to reach a public page, and there is a database
    // between those two moments.
    try {
      this.mediaLookupFor(normalizeSectionBlocks(JSON.parse(row.draft_blocks)));
    } catch (err) {
      if (err instanceof BlockError) throw new BadRequestException(err.message);
      throw err;
    }

    this.database.db
      .prepare(
        `UPDATE sections
            SET live_blocks  = draft_blocks,
                published_at = datetime('now')
          WHERE key = ?`,
      )
      .run(key);

    this.renderHome();
  }

  /** Throws away the draft and goes back to what the page is showing. */
  revert(key: SectionKey): void {
    this.database.db
      .prepare(`UPDATE sections SET draft_blocks = COALESCE(live_blocks, '[]') WHERE key = ?`)
      .run(key);
  }

  // -------------------------------------------------------------------------
  // Uploads
  // -------------------------------------------------------------------------

  private mediaRef(id: number): MediaRef | null {
    const m = this.database.db.prepare('SELECT * FROM media WHERE id = ?').get(id) as
      | MediaRow
      | undefined;
    if (!m) return null;

    return {
      filename: m.filename,
      originalName: m.original_name,
      mime: m.mime,
      sizeBytes: m.size_bytes,
      width: m.width,
      height: m.height,
    };
  }

  /**
   * A lookup that has already proved every id it will be asked for, so the
   * renderer cannot be handed a picture that was deleted between the save and
   * the publish. Refuses by name rather than writing a page with a dead src.
   */
  private mediaLookupFor(blocks: SectionBlock[]): MediaLookup {
    const found = new Map<number, MediaRef>();

    for (const b of blocks) {
      if (b.type !== 'media') continue;
      const ref = this.mediaRef(b.mediaId);
      if (!ref) throw new BadRequestException(`That picture no longer exists (upload ${b.mediaId}).`);
      found.set(b.mediaId, ref);
    }

    return (id: number) => {
      const ref = found.get(id);
      if (!ref) throw new BadRequestException(`Unknown upload id ${id}.`);
      return ref;
    };
  }

  // -------------------------------------------------------------------------
  // Disk
  // -------------------------------------------------------------------------

  /**
   * Rewrite index.html, one region per published section.
   *
   * Composes with the projects writer without either knowing about the other:
   * both read the generated file back as their own template and both leave
   * every marker they did not come for in place, so whichever ran last has the
   * other's region still in the file it started from.
   */
  renderHome(): void {
    const rows = this.database.db
      .prepare(`SELECT * FROM sections WHERE live_blocks IS NOT NULL`)
      .all() as SectionRow[];

    let html = homeTemplate();

    for (const row of rows) {
      if (!SECTION_KEYS.includes(row.key as SectionKey)) continue;

      const key = row.key as SectionKey;
      const start = sectionStart(key);
      const end = sectionEnd(key);

      // A region whose markers are not in the template is skipped rather than
      // fatal: one hand edit that dropped a comment must not make Publish
      // unusable for every other section.
      if (html.indexOf(start) === -1 || html.indexOf(end) === -1) {
        this.logger.warn(`No ${start} / ${end} pair in the home page; skipped section "${key}".`);
        continue;
      }

      // The wrapper goes in even when there is nothing to put in it. It is what
      // edit.js grabs, so a section emptied to nothing would otherwise publish
      // itself out of reach of the pen that emptied it.
      const blocks = JSON.parse(row.live_blocks as string) as SectionBlock[];
      const media = this.mediaLookupFor(blocks);
      const body = `\n${renderSection(key, blocks, media)}\n        `;

      html = spliceRegion(html, start, end, body, `the ${key} section`);
    }

    writePage('index.html', html);
  }
}
