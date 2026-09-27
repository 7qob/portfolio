import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { basename } from 'node:path';

import { config } from '../config';
import { DatabaseService } from '../db/database.service';
import type { UpdateVaultItemDto } from './dto';

export interface OverviewStats {
  users: { total: number; active: number; admins: number };
  logins: { succeeded24h: number; failed24h: number; distinctIps24h: number };
  downloads: { total: number; last30Days: number };
  sessions: { active: number };
  retentionDays: number;
}

@Injectable()
export class AdminService {
  constructor(private readonly database: DatabaseService) {}

  overview(): OverviewStats {
    const one = <T>(sql: string, ...params: unknown[]): T =>
      this.database.db.prepare(sql).get(...params) as T;

    const users = one<{ total: number; active: number; admins: number }>(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN disabled_at IS NULL THEN 1 ELSE 0 END) AS active,
              SUM(CASE WHEN role = 'admin' AND disabled_at IS NULL THEN 1 ELSE 0 END) AS admins
         FROM users`,
    );

    const logins = one<{ succeeded: number; failed: number; ips: number }>(
      `SELECT SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS succeeded,
              SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failed,
              COUNT(DISTINCT ip)                           AS ips
         FROM login_attempts
        WHERE created_at > datetime('now', '-1 day')`,
    );

    const downloads = one<{ total: number; recent: number }>(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN created_at > datetime('now', '-30 days') THEN 1 ELSE 0 END) AS recent
         FROM download_log`,
    );

    const sessions = one<{ active: number }>(
      `SELECT COUNT(*) AS active
         FROM sessions
        WHERE revoked_at IS NULL
          AND expires_at > datetime('now')
          AND absolute_expires_at > datetime('now')`,
    );

    return {
      users: {
        total: users.total,
        active: users.active ?? 0,
        admins: users.admins ?? 0,
      },
      logins: {
        succeeded24h: logins.succeeded ?? 0,
        failed24h: logins.failed ?? 0,
        distinctIps24h: logins.ips ?? 0,
      },
      downloads: {
        total: downloads.total,
        last30Days: downloads.recent ?? 0,
      },
      sessions: { active: sessions.active },
      retentionDays: config.retentionDays,
    };
  }

  logins(limit: number, offset: number): { rows: unknown[]; total: number } {
    const rows = this.database.db
      .prepare(
        `SELECT id, username, user_id, ip, user_agent, success, reason, created_at
           FROM login_attempts
          ORDER BY created_at DESC, id DESC
          LIMIT ? OFFSET ?`,
      )
      .all(limit, offset);

    const { n } = this.database.db
      .prepare('SELECT COUNT(*) AS n FROM login_attempts')
      .get() as { n: number };

    return { rows, total: n };
  }

  downloads(limit: number, offset: number): { rows: unknown[]; total: number } {
    const rows = this.database.db
      .prepare(
        `SELECT d.id, d.item_title, d.ip, d.user_agent, d.created_at,
                u.username AS username
           FROM download_log d
           LEFT JOIN users u ON u.id = d.user_id
          ORDER BY d.created_at DESC, d.id DESC
          LIMIT ? OFFSET ?`,
      )
      .all(limit, offset);

    const { n } = this.database.db
      .prepare('SELECT COUNT(*) AS n FROM download_log')
      .get() as { n: number };

    return { rows, total: n };
  }

  /** Live sessions only — an expired row is not something to act on. */
  sessions(): unknown[] {
    return this.database.db
      .prepare(
        `SELECT s.id, s.created_at, s.last_seen_at, s.expires_at, s.ip, s.user_agent,
                u.username AS username, u.role AS role
           FROM sessions s
           JOIN users u ON u.id = s.user_id
          WHERE s.revoked_at IS NULL
            AND s.expires_at > datetime('now')
            AND s.absolute_expires_at > datetime('now')
          ORDER BY s.last_seen_at DESC`,
      )
      .all();
  }

  auditLog(limit: number, offset: number): unknown[] {
    return this.database.db
      .prepare(
        `SELECT id, actor_name, action, target, detail, ip, created_at
           FROM audit_log
          ORDER BY created_at DESC, id DESC
          LIMIT ? OFFSET ?`,
      )
      .all(limit, offset);
  }

  updateVaultItem(id: number, patch: UpdateVaultItemDto): void {
    const existing = this.database.db
      .prepare('SELECT id FROM vault_items WHERE id = ?')
      .get(id);

    if (!existing) throw new NotFoundException('No such document.');

    const sets: string[] = [];
    const params: unknown[] = [];

    if (patch.title !== undefined) {
      sets.push('title = ?');
      params.push(patch.title);
    }
    if (patch.description !== undefined) {
      sets.push('description = ?');
      params.push(patch.description === '' ? null : patch.description);
    }
    if (patch.visible !== undefined) {
      sets.push('visible = ?');
      params.push(patch.visible ? 1 : 0);
    }
    if (patch.inArchive !== undefined) {
      sets.push('in_archive = ?');
      params.push(patch.inArchive ? 1 : 0);
    }
    if (patch.sortOrder !== undefined) {
      sets.push('sort_order = ?');
      params.push(patch.sortOrder);
    }
    if (patch.filename !== undefined) {
      // Reduced to a bare name before it reaches the database. The schema
      // CHECK would reject a path anyway, but rejecting it with a 500 from a
      // constraint violation is a worse answer than never building one.
      const safe = basename(patch.filename);
      if (!safe || safe === '.' || safe === '..' || safe !== patch.filename) {
        throw new BadRequestException('Filename must be a plain name, with no path.');
      }
      sets.push('filename = ?');
      params.push(safe);
    }

    if (sets.length === 0) return;

    sets.push(`updated_at = datetime('now')`);
    params.push(id);

    this.database.db
      .prepare(`UPDATE vault_items SET ${sets.join(', ')} WHERE id = ?`)
      .run(...params);
  }
}
