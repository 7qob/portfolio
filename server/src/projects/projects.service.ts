import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { existsSync, unlinkSync } from 'node:fs';

import { DatabaseService } from '../db/database.service';
import { ensurePagesDir, homeTemplate, resolvePagePath, writePage } from '../site/pages';
import {
  Block,
  BlockError,
  Chip,
  collectMediaIds,
  HOME_SLOTS,
  normalizeBlocks,
  normalizeChips,
} from './blocks';
import {
  CHIP_ICON_NAMES,
  MediaLookup,
  MediaRef,
  Neighbour,
  PageProject,
  renderHome,
  renderProjectPage,
  renderProjectsIndex,
} from './render';

export interface ProjectRow {
  id: number;
  slug: string;
  title: string;
  status: string | null;
  home_slot: string | null;
  accent: string | null;
  cover_media_id: number | null;
  repo_url: string | null;
  lede: string | null;
  card_blurb: string | null;
  chips: string;
  blocks: string;
  sort_order: number;
  visible: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

interface MediaRow {
  id: number;
  filename: string;
  original_name: string | null;
  mime: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
}

/**
 * Title -> slug, in the page-name alphabet and nothing else. The author never
 * types this: the panel shows what it derived and lets it be corrected, and
 * the result still has to pass the SLUG regex in the DTO.
 */
function slugify(title: string): string {
  return title
    // NFD splits an accented letter into the letter and a combining mark, so
    // dropping every mark leaves the letter behind. Without it the mark is
    // simply not in the alphabet below and becomes a hyphen: "Ärger" would
    // slug to "a-rger".
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '');
}

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(private readonly database: DatabaseService) {
    ensurePagesDir();
  }

  // -------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------

  list() {
    const rows = this.database.db
      .prepare('SELECT * FROM projects ORDER BY sort_order, title COLLATE NOCASE')
      .all() as ProjectRow[];
    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      status: r.status,
      homeSlot: r.home_slot,
      accent: r.accent,
      sortOrder: r.sort_order,
      visible: r.visible === 1,
      publishedAt: r.published_at,
      updatedAt: r.updated_at,
    }));
  }

  get(id: number) {
    const row = this.findById(id);
    if (!row) throw new NotFoundException('No such project.');
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      status: row.status,
      homeSlot: row.home_slot,
      accent: row.accent,
      coverMediaId: row.cover_media_id,
      repoUrl: row.repo_url,
      lede: row.lede,
      cardBlurb: row.card_blurb,
      chips: JSON.parse(row.chips) as Chip[],
      blocks: JSON.parse(row.blocks) as Block[],
      sortOrder: row.sort_order,
      visible: row.visible === 1,
      publishedAt: row.published_at,
      updatedAt: row.updated_at,
    };
  }

  findById(id: number): ProjectRow | undefined {
    return this.database.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as
      | ProjectRow
      | undefined;
  }

  // -------------------------------------------------------------------------
  // Writing
  // -------------------------------------------------------------------------

  /**
   * Creating a page asks for a title and nothing else. A slug typed by hand
   * is still honoured, but the common path derives one and disambiguates it,
   * so "New page" twice is two pages rather than a 409.
   */
  create(input: { title: string; slug?: string }): { id: number; slug: string } {
    const base = input.slug ?? slugify(input.title);
    if (!base) {
      throw new BadRequestException('That title has no letters or digits to make a slug from.');
    }
    const slug = input.slug ? base : this.freeSlug(base);

    try {
      const info = this.database.db
        .prepare('INSERT INTO projects (slug, title) VALUES (?, ?)')
        .run(slug, input.title);
      return { id: Number(info.lastInsertRowid), slug };
    } catch (err) {
      if (err instanceof Error && err.message.includes('UNIQUE')) {
        throw new ConflictException('A project with that slug already exists.');
      }
      throw err;
    }
  }

  /** `comfyui`, then `comfyui-2`, `comfyui-3`… — never a collision. */
  private freeSlug(base: string): string {
    const taken = this.database.db.prepare('SELECT 1 FROM projects WHERE slug = ?');
    if (!taken.get(base)) return base;

    for (let n = 2; n < 100; n++) {
      const candidate = `${base.slice(0, 45)}-${n}`;
      if (!taken.get(candidate)) return candidate;
    }
    throw new ConflictException('Too many pages with that name already.');
  }

  update(
    id: number,
    input: {
      slug?: string;
      title?: string;
      status?: string | null;
      homeSlot?: string | null;
      accent?: string | null;
      coverMediaId?: number | null;
      repoUrl?: string | null;
      lede?: string | null;
      cardBlurb?: string | null;
      chips?: unknown;
      blocks?: unknown;
      sortOrder?: number;
      visible?: boolean;
    },
  ): void {
    const row = this.findById(id);
    if (!row) throw new NotFoundException('No such project.');

    if (input.slug !== undefined && input.slug !== row.slug && row.published_at) {
      // The slug is the published file's name. Renaming it live would strand
      // the old file and break every link to it; unpublish first.
      throw new BadRequestException('Unpublish before changing the slug.');
    }

    let chips: Chip[] | undefined;
    let blocks: Block[] | undefined;
    try {
      if (input.chips !== undefined) chips = normalizeChips(input.chips, CHIP_ICON_NAMES);
      if (input.blocks !== undefined) blocks = normalizeBlocks(input.blocks);
    } catch (err) {
      if (err instanceof BlockError) throw new BadRequestException(err.message);
      throw err;
    }

    const homeSlot = input.homeSlot === undefined ? row.home_slot : input.homeSlot || null;
    const accent = input.accent === undefined ? row.accent : input.accent || null;
    const repoUrl = input.repoUrl === undefined ? row.repo_url : input.repoUrl || null;
    // 0 is what an empty <select> reads as, and it is no more an id than null.
    const cover =
      input.coverMediaId === undefined ? row.cover_media_id : input.coverMediaId || null;

    // One statement, one transaction: the slot swap below has to be part of
    // the same write, or a failure halfway leaves a cell holding nobody.
    this.database.db.transaction(() => {
      const displaced = homeSlot === row.home_slot ? null : this.clearHomeSlot(homeSlot, row.id);

      this.database.db
        .prepare(
          `UPDATE projects SET
             slug = ?, title = ?, status = ?, home_slot = ?, accent = ?,
             cover_media_id = ?, repo_url = ?, lede = ?, card_blurb = ?,
             chips = ?, blocks = ?, sort_order = ?, visible = ?,
             updated_at = datetime('now')
           WHERE id = ?`,
        )
        .run(
          input.slug ?? row.slug,
          input.title ?? row.title,
          input.status === undefined ? row.status : input.status,
          homeSlot,
          accent === null ? null : accent.toLowerCase(),
          cover,
          repoUrl,
          input.lede === undefined ? row.lede : input.lede,
          input.cardBlurb === undefined ? row.card_blurb : input.cardBlurb,
          chips === undefined ? row.chips : JSON.stringify(chips),
          blocks === undefined ? row.blocks : JSON.stringify(blocks),
          input.sortOrder ?? row.sort_order,
          input.visible === undefined ? row.visible : input.visible ? 1 : 0,
          id,
        );

      // Only now that this project has moved is the cell it came from free.
      if (displaced !== null) this.setHomeSlot(displaced, row.home_slot);
    })();
  }

  /**
   * Empties the cell so `keepId` can take it, and names who was in it.
   *
   * Assigning a cell another project already holds swaps the two rather than
   * returning a 400 the author has to resolve by opening the other page:
   * "put this one in Feature" only ever has one sensible reading, and the
   * project that was there goes to the cell this one is leaving — or off the
   * home page, if this one was not on it. The occupant is emptied before the
   * move rather than after, because the unique index is real: two rows may
   * not hold the same cell for even one statement.
   */
  private clearHomeSlot(slot: string | null, keepId: number): number | null {
    if (!slot) return null;

    const holder = this.database.db
      .prepare('SELECT id FROM projects WHERE home_slot = ? AND id <> ?')
      .get(slot, keepId) as { id: number } | undefined;
    if (!holder) return null;

    this.setHomeSlot(holder.id, null);
    return holder.id;
  }

  private setHomeSlot(id: number, slot: string | null): void {
    this.database.db
      .prepare(`UPDATE projects SET home_slot = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(slot, id);
  }

  remove(id: number): ProjectRow {
    const row = this.findById(id);
    if (!row) throw new NotFoundException('No such project.');
    if (row.published_at) this.unpublish(id);
    this.database.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    return row;
  }

  // -------------------------------------------------------------------------
  // Publishing
  // -------------------------------------------------------------------------

  publish(id: number): void {
    const row = this.findById(id);
    if (!row) throw new NotFoundException('No such project.');

    // Refuse before touching disk if the page depends on missing uploads.
    const blocks = JSON.parse(row.blocks) as Block[];
    this.mediaLookupFor(blocks);
    if (row.cover_media_id !== null && !this.mediaRef(row.cover_media_id)) {
      throw new BadRequestException(
        `The cover picture no longer exists (media id ${row.cover_media_id}).`,
      );
    }

    this.database.db
      .prepare(`UPDATE projects SET published_at = datetime('now') WHERE id = ?`)
      .run(id);

    this.renderAllPublished();
  }

  unpublish(id: number): void {
    const row = this.findById(id);
    if (!row) throw new NotFoundException('No such project.');

    this.database.db.prepare('UPDATE projects SET published_at = NULL WHERE id = ?').run(id);

    const path = resolvePagePath(`project-${row.slug}.html`);
    try {
      if (existsSync(path)) unlinkSync(path);
    } catch {
      this.logger.warn(`Could not remove ${path}`);
    }

    this.renderAllPublished();
  }

  /** Rewrite what is already published — placement and order changes. */
  renderPublished(): void {
    this.renderAllPublished();
  }

  /** The preview the editor opens in a new tab — absolute asset paths. */
  preview(id: number): string {
    const row = this.findById(id);
    if (!row) throw new NotFoundException('No such project.');

    const { prev, next } = this.neighboursOf(row);
    return renderProjectPage(
      this.toPage(row),
      prev,
      next,
      this.mediaLookupFor(JSON.parse(row.blocks) as Block[]),
      { assetPrefix: '/' },
    );
  }

  /**
   * Publish re-renders everything published rather than just the neighbours:
   * a sort_order change can re-chain any pager, and at this site's size
   * re-rendering the world costs milliseconds. Fewer cases, no stale chains.
   */
  private renderAllPublished(): void {
    const rows = this.database.db
      .prepare(
        `SELECT * FROM projects WHERE published_at IS NOT NULL
          ORDER BY sort_order, title COLLATE NOCASE`,
      )
      .all() as ProjectRow[];

    const chain = rows.filter((r) => r.visible === 1);

    for (const row of rows) {
      const { prev, next } = this.neighboursIn(chain, row);
      const html = renderProjectPage(
        this.toPage(row),
        prev,
        next,
        this.mediaLookupFor(JSON.parse(row.blocks) as Block[]),
      );
      writePage(`project-${row.slug}.html`, html);
    }

    writePage('projects.html', renderProjectsIndex(chain.map((r) => this.toPage(r))));

    // The home page's cards are drawn from the same chain, so a project that
    // is unpublished or hidden leaves the bento by the same act that takes it
    // off the index — a cell can never link to a page that is not there.
    const slotted = chain
      .filter((r) => r.home_slot !== null)
      .sort((a, b) => this.slotOrder(a.home_slot) - this.slotOrder(b.home_slot))
      .map((r) => this.toPage(r));

    try {
      writePage('index.html', renderHome(homeTemplate(), slotted));
    } catch (err) {
      // The project pages are already on disk and correct; only the home page
      // failed. Say which, rather than letting a 500 imply nothing published.
      throw new BadRequestException(
        `The pages are published, but the home page could not be written. ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** The cells in the order they are read, not the order they were assigned. */
  private slotOrder(slot: string | null): number {
    const i = HOME_SLOTS.indexOf(slot as (typeof HOME_SLOTS)[number]);
    return i === -1 ? HOME_SLOTS.length : i;
  }

  private toPage(row: ProjectRow): PageProject {
    return {
      slug: row.slug,
      title: row.title,
      status: row.status,
      // A cover deleted between publishes drops the rail rather than the page:
      // publish() already refused the case an author can still fix.
      cover: row.cover_media_id === null ? null : this.mediaRef(row.cover_media_id),
      accent: row.accent,
      homeSlot: row.home_slot,
      repoUrl: row.repo_url,
      lede: row.lede,
      cardBlurb: row.card_blurb,
      chips: JSON.parse(row.chips) as Chip[],
      blocks: JSON.parse(row.blocks) as Block[],
    };
  }

  private neighboursOf(row: ProjectRow): { prev: Neighbour | null; next: Neighbour | null } {
    const chain = this.database.db
      .prepare(
        `SELECT * FROM projects WHERE published_at IS NOT NULL AND visible = 1
          ORDER BY sort_order, title COLLATE NOCASE`,
      )
      .all() as ProjectRow[];
    return this.neighboursIn(chain, row);
  }

  private neighboursIn(
    chain: ProjectRow[],
    row: ProjectRow,
  ): { prev: Neighbour | null; next: Neighbour | null } {
    const i = chain.findIndex((r) => r.id === row.id);
    if (i === -1) return { prev: null, next: null };
    const toNeighbour = (r: ProjectRow | undefined): Neighbour | null =>
      r ? { slug: r.slug, title: r.title } : null;
    return { prev: toNeighbour(chain[i - 1]), next: toNeighbour(chain[i + 1]) };
  }

  /** One upload by id, or null if it is gone. */
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
   * Loads every media row the blocks reference, and throws a 400 naming the
   * missing ids if any upload has since been deleted.
   */
  private mediaLookupFor(blocks: Block[]): MediaLookup {
    const ids = collectMediaIds(blocks);
    const map = new Map<number, MediaRef>();

    for (const id of ids) {
      const ref = this.mediaRef(id);
      if (ref) map.set(id, ref);
    }

    const missing = ids.filter((id) => !map.has(id));
    if (missing.length) {
      throw new BadRequestException(
        `The page references uploads that no longer exist (media id ${missing.join(', ')}).`,
      );
    }

    return (id) => {
      const ref = map.get(id);
      if (!ref) throw new BadRequestException(`Unknown media id ${id}.`);
      return ref;
    };
  }

}
