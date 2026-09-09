/**
 * Schema history. Append-only: each entry runs once, in order, inside a
 * transaction, and SQLite's `user_version` pragma records how far we got.
 * Never edit an entry that has shipped — add another one.
 */
export const MIGRATIONS: readonly string[] = [
  // 001 — initial schema
  `
  CREATE TABLE users (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    -- NOCASE so "Kira" and "kira" cannot both exist. Logins are typed by
    -- humans reading them off a message; case is not a distinguishing feature.
    username             TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash        TEXT NOT NULL,
    role                 TEXT NOT NULL CHECK (role IN ('user', 'admin')),
    display_name         TEXT,
    -- Free-text reminder of who this login was issued to, e.g. which company.
    note                 TEXT,
    created_at           TEXT NOT NULL DEFAULT (datetime('now')),
    created_by           INTEGER REFERENCES users(id) ON DELETE SET NULL,
    -- Disable rather than delete: deleting the row would take the audit trail
    -- of what that account did with it.
    disabled_at          TEXT,
    last_login_at        TEXT,
    must_change_password INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE sessions (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- SHA-256 of the cookie value, never the value itself. Someone who reads
    -- this table cannot mint a working cookie from it.
    token_hash          TEXT NOT NULL UNIQUE,
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at        TEXT NOT NULL DEFAULT (datetime('now')),
    -- Two clocks: idle expiry slides forward on use, absolute expiry does not.
    expires_at          TEXT NOT NULL,
    absolute_expires_at TEXT NOT NULL,
    ip                  TEXT,
    user_agent          TEXT,
    revoked_at          TEXT
  );

  CREATE INDEX idx_sessions_user    ON sessions(user_id);
  CREATE INDEX idx_sessions_expires ON sessions(expires_at);

  CREATE TABLE login_attempts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    -- Kept as typed, not resolved to a user: a failure against a username
    -- that does not exist is exactly the thing worth being able to see.
    username   TEXT NOT NULL,
    user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    ip         TEXT,
    user_agent TEXT,
    success    INTEGER NOT NULL,
    reason     TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX idx_login_attempts_ip       ON login_attempts(ip, created_at);
  CREATE INDEX idx_login_attempts_username ON login_attempts(username, created_at);

  CREATE TABLE vault_items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    slug        TEXT NOT NULL UNIQUE,
    title       TEXT NOT NULL,
    description TEXT,
    -- A bare filename, resolved against VAULT_FILES_DIR at read time. The
    -- CHECK is defence in depth: the application already refuses anything
    -- that is not a plain name, and this makes a traversal string
    -- unstorable even if that check is ever bypassed.
    filename    TEXT NOT NULL CHECK (
                  filename <> ''
                  AND filename NOT LIKE '%/%'
                  AND filename NOT LIKE '%' || char(92) || '%'
                  AND filename NOT LIKE '%..%'
                ),
    mime        TEXT NOT NULL DEFAULT 'application/pdf',
    sort_order  INTEGER NOT NULL DEFAULT 0,
    visible     INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE download_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
    vault_item_id INTEGER REFERENCES vault_items(id) ON DELETE SET NULL,
    -- Denormalised so the log still reads correctly after an item is renamed
    -- or removed. A log that changes retroactively is not a log.
    item_title    TEXT,
    ip            TEXT,
    user_agent    TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX idx_download_log_created ON download_log(created_at);
  CREATE INDEX idx_download_log_user    ON download_log(user_id);

  CREATE TABLE audit_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    actor_name    TEXT,
    action        TEXT NOT NULL,
    target        TEXT,
    detail        TEXT,
    ip            TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX idx_audit_created ON audit_log(created_at);
  `,

  // 002 — the two documents the old hardcoded vault page listed.
  //
  // Not invented content: these are the exact filenames vault/index.html
  // already pointed at and that deploy/README.md tells you to upload. Seeding
  // them keeps the page identical across the switch instead of coming up
  // empty and looking broken. Rows are harmless while the files are absent —
  // the API reports them as unavailable until the PDFs actually exist.
  `
  INSERT INTO vault_items (slug, title, description, filename, sort_order) VALUES
    ('cv',         'Curriculum Vitae', NULL, 'cv.pdf',         10),
    ('zeugnisse',  'School reports',   NULL, 'zeugnisse.pdf',  20);
  `,

  // 003 — project pages authored in the admin panel.
  //
  // A project row is the source of a generated static page: Publish renders
  // the blocks JSON to /site/pages/project-<slug>.html and nothing at request
  // time ever reads this table. The slug CHECK mirrors vault_items.filename —
  // the slug becomes part of a filesystem path on publish, so a traversal
  // string must be unstorable even if the application check is bypassed.
  `
  CREATE TABLE projects (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    slug         TEXT NOT NULL UNIQUE CHECK (
                   slug <> ''
                   AND slug NOT LIKE '%/%'
                   AND slug NOT LIKE '%' || char(92) || '%'
                   AND slug NOT LIKE '%..%'
                 ),
    title        TEXT NOT NULL,
    -- Chip shown next to the title: 'WIP' | 'Featured' | NULL for none.
    status       TEXT,
    -- Accent palette class suffix, e.g. 'comfy' -> .is-comfy on .page-head.
    palette      TEXT,
    lede         TEXT,
    -- The one-liner on the projects.html card, distinct from the lede.
    card_blurb   TEXT,
    chips        TEXT NOT NULL DEFAULT '[]', -- JSON [{label, icon}]
    blocks       TEXT NOT NULL DEFAULT '[]', -- JSON array, the page body
    sort_order   INTEGER NOT NULL DEFAULT 0,
    visible      INTEGER NOT NULL DEFAULT 1,
    -- Set on publish, cleared on unpublish. A row with published_at NULL has
    -- no file on disk and appears nowhere on the public site.
    published_at TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Uploaded media. filename is content-addressed (<sha256[0:16]>.<ext>),
  -- generated server-side — the client never chooses it — and the CHECK is
  -- the same defence in depth as vault_items. width/height are measured in
  -- the browser before upload and become the img/video attributes that stop
  -- layout shift; size_bytes feeds the computed .reveal__hint.
  CREATE TABLE media (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    filename      TEXT NOT NULL UNIQUE CHECK (
                    filename <> ''
                    AND filename NOT LIKE '%/%'
                    AND filename NOT LIKE '%' || char(92) || '%'
                    AND filename NOT LIKE '%..%'
                  ),
    original_name TEXT,
    mime          TEXT NOT NULL,
    size_bytes    INTEGER NOT NULL,
    width         INTEGER,
    height        INTEGER,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,

  // 004 — a project can sit on the home page, carry its own colour and link
  // its repository; the block catalogue shrinks to text and media.
  //
  // The CHECKs are the same defence in depth as the slug's: home_slot ends up
  // in a CSS class name and accent ends up inside a style attribute on a
  // public page, so neither may hold anything but the shapes below even if
  // the application check is somehow bypassed. GLOB is case-sensitive, which
  // is why the service lowercases the hex before it stores it.
  `
  ALTER TABLE projects ADD COLUMN home_slot TEXT CHECK (
    home_slot IS NULL OR home_slot IN ('feature', 'tall', 'smallA', 'smallB')
  );

  ALTER TABLE projects ADD COLUMN repo_url TEXT CHECK (
    repo_url IS NULL OR repo_url LIKE 'https://github.com/%'
  );

  ALTER TABLE projects ADD COLUMN accent TEXT CHECK (
    accent IS NULL OR accent GLOB '#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'
  );

  -- One project per cell, enforced by the database rather than by the two
  -- places that write it. Partial, so any number of projects may be off the
  -- home page at once.
  CREATE UNIQUE INDEX idx_projects_home_slot
    ON projects(home_slot) WHERE home_slot IS NOT NULL;

  -- The named palettes are gone: one hex in accent replaces three hand-picked
  -- ones per project in style.css, which is what made adding a project a
  -- stylesheet edit.
  ALTER TABLE projects DROP COLUMN palette;

  -- section | steps | features | table | figure | datarow | files | links no
  -- longer normalise, and a stored draft holding one would 400 the editor
  -- every time it opened — unfixably, since the only way to fix it is the
  -- editor. Empty the body instead: the head fields survive, the bands are
  -- retyped. Both spacings are matched because the JSON may have been written
  -- by hand rather than by JSON.stringify.
  UPDATE projects SET blocks = '[]'
   WHERE blocks LIKE '%"type": "section"%'  OR blocks LIKE '%"type":"section"%'
      OR blocks LIKE '%"type": "steps"%'    OR blocks LIKE '%"type":"steps"%'
      OR blocks LIKE '%"type": "features"%' OR blocks LIKE '%"type":"features"%'
      OR blocks LIKE '%"type": "table"%'    OR blocks LIKE '%"type":"table"%'
      OR blocks LIKE '%"type": "figure"%'   OR blocks LIKE '%"type":"figure"%'
      OR blocks LIKE '%"type": "datarow"%'  OR blocks LIKE '%"type":"datarow"%'
      OR blocks LIKE '%"type": "files"%'    OR blocks LIKE '%"type":"files"%'
      OR blocks LIKE '%"type": "links"%'    OR blocks LIKE '%"type":"links"%';
  `,

  // 005 — a project carries a picture on the projects index.
  //
  // One upload, shown on the index row and nowhere else: the row's rail is
  // what tells four projects apart at a glance now that the accent is a
  // hairline. No REFERENCES: media rows are deleted through MediaService,
  // which refuses while anything still points at the file and says what — a
  // foreign key would raise SQLITE_CONSTRAINT instead of naming the project.
  `
  ALTER TABLE projects ADD COLUMN cover_media_id INTEGER;
  `,

  /**
   * 006 — the sections CMS.
   *
   * The second thing that writes index.html. A row holds one region of the
   * home page: `draft_blocks` is what the in-page editor last saved,
   * `live_blocks` is what the published file shows.
   *
   * `live_blocks IS NULL` is load-bearing and means "never published" — the
   * renderer then skips that region entirely and the hand-written markup
   * between the markers stays exactly as it shipped. That is what makes this
   * table safe to create on a live Pi: until someone presses Publish, the page
   * is byte-identical to the one already being served.
   *
   * The key CHECK mirrors the SECTION_KEYS registry in sections/blocks.ts, the
   * same belt-and-braces the projects slug and the media filename get.
   */
  `
  CREATE TABLE sections (
    key          TEXT PRIMARY KEY CHECK (key GLOB '[a-z][a-z0-9-]*'),
    draft_blocks TEXT NOT NULL DEFAULT '[]',
    live_blocks  TEXT,
    updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
    published_at TEXT
  );
  `,
];
