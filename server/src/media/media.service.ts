import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';

import { config } from '../config';
import { DatabaseService } from '../db/database.service';
import { Block, collectMediaIds } from '../projects/blocks';

export interface MediaRow {
  id: number;
  filename: string;
  original_name: string | null;
  mime: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  created_at: string;
}

/**
 * What may be uploaded, and how each type proves what it is. The declared
 * Content-Type gets a file into the door; the bytes decide what it is stored
 * as. A .png that starts with %PDF is rejected, not renamed.
 */
const SNIFFERS: { mime: string; ext: string; test: (buf: Buffer) => boolean }[] = [
  {
    mime: 'image/png',
    ext: 'png',
    test: (b) => b.length > 8 && b.readUInt32BE(0) === 0x89504e47,
  },
  {
    mime: 'image/jpeg',
    ext: 'jpg',
    test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: 'image/gif',
    ext: 'gif',
    test: (b) => b.length > 6 && (b.toString('latin1', 0, 6) === 'GIF87a' || b.toString('latin1', 0, 6) === 'GIF89a'),
  },
  {
    mime: 'image/webp',
    ext: 'webp',
    test: (b) =>
      b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP',
  },
  {
    mime: 'video/mp4',
    ext: 'mp4',
    test: (b) => b.length > 12 && b.toString('latin1', 4, 8) === 'ftyp',
  },
  {
    mime: 'application/pdf',
    ext: 'pdf',
    test: (b) => b.length > 5 && b.toString('latin1', 0, 5) === '%PDF-',
  },
  {
    // JSON has no magic bytes; the file proving it parses is the check.
    mime: 'application/json',
    ext: 'json',
    test: (b) => {
      try {
        JSON.parse(b.toString('utf8'));
        return true;
      } catch {
        return false;
      }
    },
  },
];

const ALLOWED_MIMES = new Set(SNIFFERS.map((s) => s.mime));

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(private readonly database: DatabaseService) {
    try {
      mkdirSync(resolve(config.site.mediaDir), { recursive: true });
    } catch {
      this.logger.warn(`Could not create media directory ${config.site.mediaDir}`);
    }
  }

  list(): MediaRow[] {
    return this.database.db
      .prepare('SELECT * FROM media ORDER BY created_at DESC, id DESC')
      .all() as MediaRow[];
  }

  findById(id: number): MediaRow | undefined {
    return this.database.db.prepare('SELECT * FROM media WHERE id = ?').get(id) as
      | MediaRow
      | undefined;
  }

  /**
   * Stores an upload under a content-addressed name: <sha256[0:16]>.<ext>,
   * chosen entirely server-side. Re-uploading the same bytes returns the
   * existing row instead of a duplicate — which is also what makes nginx's
   * long max-age on /assets/ safe: changed content is always a new URL.
   */
  store(input: {
    buffer: Buffer;
    originalName: string | null;
    declaredMime: string;
    width: number | null;
    height: number | null;
  }): MediaRow {
    const sniffed = SNIFFERS.find((s) => s.test(input.buffer));
    if (!sniffed) {
      throw new BadRequestException(
        'Unrecognised file type. Allowed: PNG, JPEG, WebP, GIF, MP4, JSON, PDF.',
      );
    }

    // Browsers are sloppy about Content-Type (octet-stream for .json is
    // common), so the bytes are authoritative. But when the client DID
    // declare an allowed type, it has to be the type the bytes show —
    // a mismatch means someone is dressing one thing up as another.
    if (ALLOWED_MIMES.has(input.declaredMime) && input.declaredMime !== sniffed.mime) {
      throw new BadRequestException(
        `The file says it is ${input.declaredMime} but its content is ${sniffed.mime}.`,
      );
    }

    const hash = createHash('sha256').update(input.buffer).digest('hex');
    const filename = `${hash.slice(0, 16)}.${sniffed.ext}`;

    const existing = this.database.db.prepare('SELECT * FROM media WHERE filename = ?').get(filename) as
      | MediaRow
      | undefined;
    if (existing) return existing;

    const path = this.resolveMediaPath(filename);
    const tmp = path + '.tmp';
    writeFileSync(tmp, input.buffer);
    renameSync(tmp, path);

    const info = this.database.db
      .prepare(
        `INSERT INTO media (filename, original_name, mime, size_bytes, width, height)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        filename,
        input.originalName,
        sniffed.mime,
        input.buffer.length,
        input.width,
        input.height,
      );

    return this.findById(Number(info.lastInsertRowid))!;
  }

  /**
   * Refuses (409) while any project still references the file — as a block's
   * media or as the index row's cover. Deleting it would break a published
   * page's images. The caller sees which ones.
   */
  remove(id: number): MediaRow {
    const row = this.findById(id);
    if (!row) throw new NotFoundException('No such upload.');

    const users = (
      this.database.db.prepare('SELECT slug, blocks, cover_media_id FROM projects').all() as {
        slug: string;
        blocks: string;
        cover_media_id: number | null;
      }[]
    ).filter((p) => {
      if (p.cover_media_id === id) return true;
      try {
        return collectMediaIds(JSON.parse(p.blocks) as Block[]).includes(id);
      } catch {
        return false;
      }
    });

    if (users.length) {
      throw new ConflictException(
        `Still used by: ${users.map((u) => u.slug).join(', ')}. Remove it from those pages first.`,
      );
    }

    try {
      const path = this.resolveMediaPath(row.filename);
      if (existsSync(path)) unlinkSync(path);
    } catch {
      this.logger.warn(`Could not remove media file ${row.filename}`);
    }

    this.database.db.prepare('DELETE FROM media WHERE id = ?').run(id);
    return row;
  }

  /** Same last-line-of-defence shape as VaultService.resolvePath. */
  private resolveMediaPath(filename: string): string {
    const safeName = basename(filename);
    if (!safeName || safeName === '.' || safeName === '..') {
      throw new BadRequestException('Refusing that filename.');
    }

    const root = resolve(config.site.mediaDir);
    const path = resolve(join(root, safeName));

    if (!path.startsWith(root + sep)) {
      this.logger.warn(`Refused a path outside the media directory: ${filename}`);
      throw new BadRequestException('Refusing that filename.');
    }

    return path;
  }
}
