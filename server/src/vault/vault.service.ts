import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import {
  createReadStream,
  existsSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  type Stats,
} from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';

import { config } from '../config';
import { DatabaseService } from '../db/database.service';
import { zipStore, type ZipEntry } from './zip';

/**
 * The archive is built in memory, so its size is a memory limit rather than a
 * policy. Sixty-four megabytes is far more than a stack of school documents
 * and small enough that a Pi survives two people clicking at once.
 */
const ARCHIVE_MAX_BYTES = 64 * 1024 * 1024;

export interface VaultItemRow {
  id: number;
  slug: string;
  title: string;
  description: string | null;
  filename: string;
  mime: string;
  sort_order: number;
  visible: number;
  created_at: string;
  updated_at: string;
}

export interface VaultItemView {
  id: number;
  slug: string;
  title: string;
  description: string | null;
  mime: string;
  /** null when the file is not on disk yet. */
  sizeBytes: number | null;
  available: boolean;
}

@Injectable()
export class VaultService {
  private readonly logger = new Logger(VaultService.name);

  constructor(private readonly database: DatabaseService) {}

  /**
   * What a signed-in visitor sees. Note what is absent: `filename` never
   * leaves the server. The client addresses documents by id, so there is no
   * point at which a caller learns a path, and therefore no path for them to
   * try manipulating.
   */
  listVisible(): VaultItemView[] {
    const rows = this.database.db
      .prepare(
        `SELECT * FROM vault_items
          WHERE visible = 1
          ORDER BY sort_order, title COLLATE NOCASE`,
      )
      .all() as VaultItemRow[];

    return rows.map((row) => this.toView(row));
  }

  listAll(): (VaultItemView & { filename: string; visible: boolean; sortOrder: number })[] {
    const rows = this.database.db
      .prepare('SELECT * FROM vault_items ORDER BY sort_order, title COLLATE NOCASE')
      .all() as VaultItemRow[];

    return rows.map((row) => ({
      ...this.toView(row),
      filename: row.filename,
      visible: row.visible === 1,
      sortOrder: row.sort_order,
    }));
  }

  findById(id: number): VaultItemRow | undefined {
    return this.database.db.prepare('SELECT * FROM vault_items WHERE id = ?').get(id) as
      | VaultItemRow
      | undefined;
  }

  /**
   * A new document row, born without a file. The filename is derived from the
   * slug here and again on every upload — the client never chooses it, same
   * rule as the media store. The row shows as "missing" until a PDF lands.
   */
  createItem(input: { slug: string; title: string; description: string | null }): VaultItemRow {
    try {
      const info = this.database.db
        .prepare(
          `INSERT INTO vault_items (slug, title, description, filename, sort_order)
           VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM vault_items))`,
        )
        .run(input.slug, input.title, input.description, `${input.slug}.pdf`);
      return this.findById(Number(info.lastInsertRowid))!;
    } catch (err) {
      if (err instanceof Error && err.message.includes('UNIQUE')) {
        throw new ConflictException('A document with that slug already exists.');
      }
      throw err;
    }
  }

  /**
   * Stores the uploaded PDF as <slug>.pdf. The bytes decide what the file is:
   * anything that does not start with %PDF- is refused, whatever the upload
   * claimed. Write-then-rename, so a concurrent download never reads half a
   * file — re-uploading replaces the old one in place under the same name,
   * which is fine because downloads are no-store end to end.
   */
  saveFile(row: VaultItemRow, buffer: Buffer): void {
    if (buffer.length < 5 || buffer.toString('latin1', 0, 5) !== '%PDF-') {
      throw new BadRequestException('That file is not a PDF.');
    }

    const filename = `${row.slug}.pdf`;
    const path = this.resolvePath(filename);
    const tmp = path + '.tmp';
    writeFileSync(tmp, buffer);
    renameSync(tmp, path);

    this.database.db
      .prepare(
        `UPDATE vault_items
            SET filename = ?, mime = 'application/pdf', updated_at = datetime('now')
          WHERE id = ?`,
      )
      .run(filename, row.id);
  }

  /**
   * Removes the row and its file. The download log survives it — entries keep
   * the denormalised title and their item id goes NULL, exactly what the
   * ON DELETE SET NULL in the schema is for.
   */
  deleteItem(row: VaultItemRow): void {
    try {
      const path = this.resolvePath(row.filename);
      if (existsSync(path)) unlinkSync(path);
    } catch {
      this.logger.warn(`Could not remove vault file ${row.filename}`);
    }

    this.database.db.prepare('DELETE FROM vault_items WHERE id = ?').run(row.id);
  }

  private toView(row: VaultItemRow): VaultItemView {
    const stats = this.statFile(row.filename);
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      description: row.description,
      mime: row.mime,
      sizeBytes: stats?.size ?? null,
      available: stats !== null,
    };
  }

  private statFile(filename: string): Stats | null {
    try {
      const path = this.resolvePath(filename);
      if (!existsSync(path)) return null;

      const stats = statSync(path);
      return stats.isFile() ? stats : null;
    } catch {
      return null;
    }
  }

  /**
   * The last line of defence on path traversal, after the DTO check on the
   * way in and the CHECK constraint in the schema.
   *
   * basename() discards any directory part outright, and the containment test
   * afterwards catches what basename cannot: a symlink inside the directory
   * pointing somewhere else entirely. The trailing separator on the prefix
   * matters — without it, "/vault-files-secret" passes a naive startsWith
   * against "/vault-files".
   */
  resolvePath(filename: string): string {
    const safeName = basename(filename);
    if (!safeName || safeName === '.' || safeName === '..') {
      throw new NotFoundException('Document not found.');
    }

    const root = resolve(config.vault.filesDir);
    const path = resolve(join(root, safeName));

    if (path !== root && !path.startsWith(root + sep)) {
      this.logger.warn(`Refused a path outside the vault directory: ${filename}`);
      throw new NotFoundException('Document not found.');
    }

    return path;
  }

  openStream(row: VaultItemRow): { stream: NodeJS.ReadableStream; size: number } {
    const path = this.resolvePath(row.filename);

    if (!existsSync(path)) {
      throw new NotFoundException('That document has not been uploaded yet.');
    }

    const stats = statSync(path);
    if (!stats.isFile()) throw new NotFoundException('Document not found.');

    return { stream: createReadStream(path), size: stats.size };
  }

  /**
   * Every visible document that is actually on disk, as one ZIP.
   *
   * It logs a download per document rather than one for the archive: the log
   * answers "who has read my references", and an entry that said "downloaded
   * everything" would make that question unanswerable a year from now, when
   * what "everything" meant has changed.
   *
   * Missing files are skipped rather than raised. A row without a PDF is a
   * normal state here (the panel creates the row first and uploads after), and
   * one un-uploaded document should not cost the visitor the other five.
   */
  archiveVisible(actor: { userId: number; ip: string; userAgent: string }): {
    buffer: Buffer;
    count: number;
  } {
    const rows = this.database.db
      .prepare(
        `SELECT * FROM vault_items
          WHERE visible = 1
          ORDER BY sort_order, title COLLATE NOCASE`,
      )
      .all() as VaultItemRow[];

    const entries: ZipEntry[] = [];
    let total = 0;

    for (const row of rows) {
      const stats = this.statFile(row.filename);
      if (!stats) continue;

      total += stats.size;
      if (total > ARCHIVE_MAX_BYTES) {
        throw new PayloadTooLargeException('The documents are too large to send as one file.');
      }

      entries.push({
        // basename() again rather than the stored name: resolvePath already
        // refused anything outside the directory, and this keeps a directory
        // part from ever reaching the archive's own name field.
        name: basename(row.filename),
        data: readFileSync(this.resolvePath(row.filename)),
        modified: stats.mtime,
      });

      this.logDownload({
        userId: actor.userId,
        item: row,
        ip: actor.ip,
        userAgent: actor.userAgent,
      });
    }

    if (!entries.length) {
      throw new NotFoundException('No documents have been uploaded yet.');
    }

    return { buffer: zipStore(entries), count: entries.length };
  }

  /**
   * The title is copied in rather than joined at read time, so the log still
   * says what was actually downloaded after an item is renamed or removed. A
   * record that changes retroactively is not a record.
   */
  logDownload(input: {
    userId: number;
    item: VaultItemRow;
    ip: string;
    userAgent: string;
  }): void {
    this.database.db
      .prepare(
        `INSERT INTO download_log (user_id, vault_item_id, item_title, ip, user_agent)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(input.userId, input.item.id, input.item.title, input.ip, input.userAgent);
  }
}
