# Vault backend + admin panel — plan

Status: **awaiting go-ahead**. Nothing below is built yet.

---

## Part 0 — The brief, rewritten

The original request, restated as a spec. Read this and correct me before I start;
it is cheaper to fix a sentence here than a module later.

> **Goal.** Replace the vault's shared nginx Basic Auth password with a real
> per-person login system, and add an admin panel only I can reach.
>
> **Accounts.** Username + password. Accounts are issued by me — there is no
> public sign-up, no password reset by email, no "forgot password" flow. Two
> roles: `user` (vault only) and `admin` (vault + admin panel). Credentials
> live in a small SQLite database, passwords stored as argon2id hashes.
>
> **Vault.** Currently the document list is hardcoded in `vault/index.html`,
> which means anyone who views source on a public deploy learns what documents
> I hold and what they are called. After this change the page ships empty and
> the list comes from the API only once authenticated. The PDFs move out of the
> web root entirely, so nginx cannot serve them even by accident — they are
> streamed by the API after an auth check, and every download is logged.
>
> **Admin panel.** A tab that only appears for admins, showing: who logged in,
> when, from which IP and browser; failed attempts; active sessions (with a
> revoke button); who downloaded which document and when; and the account list,
> where I can create logins, disable them, and reset passwords. No anonymous
> visitor tracking — only the activity of people who actually logged in.
>
> **Deployment.** The API is a NestJS + TypeScript service in a Docker image,
> built for linux/arm64 by GitHub Actions and published to GHCR. The Pi pulls
> the image; it never compiles anything. nginx keeps serving the static site
> and reverse-proxies `/api/` to the container. The database and the PDFs live
> in a bind mount on the Pi and never enter the image or git.
>
> **Also.** Improve the GitHub contribution graph on the home page.
>
> **Constraints.** The repo is public — no secret may ever be committed. The
> static pages must keep working without the backend (the vault and admin pages
> degrade to a clear message rather than breaking). Commits are authored by
> 7qob and pushed regularly.

### What this costs you

Three honest trade-offs, so none of them is a surprise later:

1. **The site stops being fully static.** `index.html`, `projects.html`,
   `about.html` and `impressum.html` still open over `file://` and would still
   work on GitHub Pages. The vault and the admin panel will not — they need the
   Pi running and the container up. Router reboot now takes down the vault, not
   just the site.
2. **`CLAUDE.md` currently forbids this.** It says static HTML/CSS/JS only, no
   backend, no build step, no npm. That document describes the scaffold this
   project started as, not what it is now. I will update it rather than quietly
   contradict it.
3. **You are now storing personal data.** Login times, IP addresses and
   user-agent strings of real people you gave access to. That is lawful and
   normal for an access-controlled area, but it needs a retention limit and a
   line in the Impressum. Both are in the plan.

---

## Part 1 — Architecture

```
Internet
  └─ Cloudflare Tunnel (HTTPS terminates at Cloudflare's edge)
       └─ nginx on the Pi, :80
            ├─ /               → /var/www/kira1q.dev        static, unchanged
            ├─ /api/           → 127.0.0.1:8080             the container
            └─ /vault/files/   → deny                       files no longer here

Docker (Pi)
  └─ ghcr.io/7qob/portfolio-api:latest   (linux/arm64, non-root)
       ├─ /data/app.db          ← bind mount /var/lib/kira1q/data
       └─ /vault-files/         ← bind mount /var/lib/kira1q/vault-files (ro)
```

nginx stays on the host rather than moving into compose. The static site is
already served correctly by it, and keeping it there means the portfolio stays
up even when the API container is down or being redeployed.

---

## Part 2 — Database

SQLite, one file, WAL mode. Migrations run on boot.

| Table | Purpose |
|---|---|
| `users` | id, username (unique), password_hash, role, display_name, created_at, disabled_at, last_login_at, must_change_password |
| `sessions` | id, user_id, token_hash, created_at, expires_at, last_seen_at, ip, user_agent, revoked_at |
| `login_attempts` | username, ip, success, reason, created_at — powers both the rate limiter and the admin panel's login view |
| `vault_items` | slug, title, description, filename, mime, sort_order, visible — the document list, previously hardcoded in HTML |
| `download_log` | user_id, vault_item_id, ip, user_agent, created_at |
| `audit_log` | actor_user_id, action, target, detail, ip, created_at — account created / disabled / password reset |

Retention: `login_attempts` and `download_log` auto-purge after 90 days by a
scheduled job. Expired sessions purge daily.

---

## Part 3 — Security decisions

These are the parts worth getting right, so I am stating them rather than
burying them in code.

- **Password hashing:** argon2id, per-user salt. Native build happens in the
  Docker build stage on CI, never on the Pi.
- **I never see or choose a password.** Creating an account makes the *server*
  generate a strong one and display it exactly once, in your admin panel. Only
  the hash is stored. Resets work the same way. No plaintext password will
  appear in this repo, in a config file, or in our conversation.
- **Sessions:** 256-bit random opaque token in an `HttpOnly; Secure;
  SameSite=Lax; Path=/` cookie. The database stores only its SHA-256, so a
  database leak does not hand over live sessions. Sliding 8h idle expiry,
  7 day absolute cap.
- **Rate limiting:** per-IP and per-username, counted from `login_attempts`.
  5 failures triggers a 15-minute lockout with exponential backoff. This is the
  gap the current Basic Auth setup explicitly has — `deploy/README.md` already
  admits nothing rate-limits it.
- **No user enumeration:** wrong username and wrong password return the same
  generic error, in constant time.
- **CSRF:** same-origin only, no CORS origins allowed, plus a required custom
  header on every state-changing request (a browser cannot send one
  cross-origin without a preflight the server will refuse).
- **File streaming:** vault files are looked up by database id, never by a
  client-supplied path, so path traversal has no surface to attack. The mount
  is read-only.
- **`Secure` cookie caveat:** the login will not work over plain
  `http://192.168.0.56/` on your LAN, because the browser refuses to send a
  Secure cookie over HTTP. Test the login through `https://kira1q.dev` once the
  tunnel is up. This is the right trade — the alternative is sending session
  tokens in clear text over your LAN.

---

## Part 4 — API surface

```
POST   /api/auth/login              → sets session cookie
POST   /api/auth/logout
GET    /api/auth/me                 → { username, role, displayName } | 401
POST   /api/auth/password           → change own password

GET    /api/vault/items             auth  → document list from DB
GET    /api/vault/items/:id/file    auth  → streams the PDF, logs the download

GET    /api/admin/overview          admin → counts + recent activity
GET    /api/admin/logins            admin → paged login attempts
GET    /api/admin/sessions          admin → active sessions
DELETE /api/admin/sessions/:id      admin → revoke one
GET    /api/admin/downloads         admin
GET    /api/admin/users             admin
POST   /api/admin/users             admin → create, returns generated password once
PATCH  /api/admin/users/:id         admin → enable / disable / change role
POST   /api/admin/users/:id/password admin → reset, returns new password once
GET    /api/admin/vault-items       admin
PATCH  /api/admin/vault-items/:id   admin → title, description, order, visibility

GET    /api/github/contributions    public, cached 6h — proxies the third-party
                                    graph API so visitors' IPs never reach it
GET    /api/health
```

**Bootstrapping the first admin** is a one-off command on the Pi:

```bash
docker compose exec api node dist/cli.js create-admin <username>
```

It prints a generated password once and exits. That is the only way an account
exists before you have an account.

---

## Part 5 — Frontend

| File | Change |
|---|---|
| `login.html` | New. Username + password, error states, "need access? email me". |
| `vault/index.html` | Hardcoded document list removed. Renders from `/api/vault/items`; a 401 redirects to `login.html?next=/vault/`. |
| `admin.html` | New. Tabs: Overview, Logins, Sessions, Users, Downloads, Vault items. Admin-guarded server-side, not just hidden in CSS. |
| `vault-locked.html` | Retired — it exists to serve nginx's Basic Auth 401, which is going away. Redirects to `login.html`. |
| `script.js` | Adds a small auth module: fetches `/api/auth/me`, reveals the Admin nav link for admins, adds a log-out control. |
| `admin.js` | New, loaded only by `admin.html`, so the home page does not carry admin code. |

The Admin tab is hidden for everyone else, but hiding is cosmetic — every admin
route is guarded on the server. Someone unhiding the link in devtools gets 403.

---

## Part 6 — GitHub graph improvements

Current state: fetches the third-party API on every page load, renders bare
squares, and on failure leaves an empty box with only a console error.

- Month labels across the top, weekday labels down the side
- A `Less → More` legend
- Total contributions in the last year, current streak, longest streak
- A real tooltip that also works on keyboard focus, replacing the raw `title`
  attribute (which never appears for keyboard or touch users)
- A visible loading state and a visible error state with a retry button
- Served through `/api/github/contributions`, cached 6h server-side, with a
  direct client-side fetch as fallback when the backend is absent — so the graph
  still works over `file://`
- `localStorage` cache so a repeat visit paints instantly and survives an
  outage of the third-party service

---

## Part 7 — Deployment

- `server/Dockerfile` — multi-stage, `node:22-alpine`, runs as non-root
- `docker-compose.yml` — image, bind mounts, env file, `restart: unless-stopped`
- `.github/workflows/api-image.yml` — buildx, `linux/arm64`, push to GHCR on
  every push to `main`
- `deploy/nginx-kira1q.dev.conf` — add the `/api/` proxy, delete the Basic Auth
  block, deny `/vault/files/`
- `deploy/README.md` — new section: first deploy, creating the first admin,
  moving the PDFs out of the web root, updating
- `.gitignore` — `*.db`, `*.db-wal`, `*.db-shm`, `.env`, `server/node_modules/`
- `CLAUDE.md` — updated so it describes the project as it now is
- `impressum.html` — a short, accurate note on what the login area logs and for
  how long

---

## Part 8 — Order of work

Each line is one commit, pushed as it lands. The graph goes first because it is
independent and ships value immediately; the frontend only gets rewired once
the API it depends on actually exists.

1. `fix(gh): improve contribution graph` — frontend only, no backend needed
2. `feat(api): scaffold NestJS service, SQLite schema, Docker image`
3. `feat(api): authentication, sessions, rate limiting, admin bootstrap CLI`
4. `feat(api): vault items and gated file streaming`
5. `feat(api): admin endpoints`
6. `feat(web): login page, vault rewired to the API`
7. `feat(web): admin panel`
8. `feat(ci): arm64 image build and GHCR publish`
9. `chore(deploy): nginx proxy, compose, docs, privacy note`

Steps 1–8 are all done on this machine and verified as far as they can be
without a Pi. Step 9 leaves you a checklist to run on the Pi itself — moving the
PDFs and creating your admin account are yours to do, not mine.
