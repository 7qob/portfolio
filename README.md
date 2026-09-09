# kira1q.dev

My personal portfolio site, plus a small private area for job applications.

The site is deliberately two separable halves: a static front end that works
with no server at all, and a small API that only three pages ever talk to.

## Front end — static HTML, CSS and JS

No framework, no build step, no bundler, no dependencies. `index.html`,
`projects.html`, `impressum.html` and the project pages open
straight off disk over `file://` and would run unchanged on GitHub Pages.
The whole static site is about 50 KB.

To work on it, serve the folder and open it:

```sh
python -m http.server 8123
# http://127.0.0.1:8123
```

A plain file server is enough — there is nothing to compile.

Only `login.html`, `vault/` and `admin.html` need the API, and each degrades
to a plain message rather than a broken screen when it is not reachable.

### Design

Retro, KISS, classic — 1px borders on every box, `border-radius: 0`, no
box-shadows. Depth comes from the border and the panel/background contrast and
nothing else. Dark theme by default with a light theme behind the header
toggle; colours are CSS variables and only the primitives are overridden.
Spacing comes off a single `--space` unit. Serif type throughout.

All of it is in one file, `style.css`, and the comments there explain the
reasoning behind the parts that look odd.

## Back end — `server/`

A NestJS + TypeScript service behind nginx at `/api/`, added when the vault
moved from one shared password to per-person accounts. It is the only part of
the repo with a build step and dependencies.

It holds a SQLite database of accounts, sessions, login attempts, vault
documents, downloads and an audit log:

- Passwords are hashed with argon2id.
- Sessions are opaque random tokens, stored as SHA-256, in an
  `HttpOnly; Secure; SameSite=Lax` cookie.
- Nothing is signed, so **there is no secret anywhere in the service** — which
  is why the image can be public and the compose file carries no credentials.
- Accounts are issued by an admin; the password is generated server-side and
  shown exactly once.

Because the cookie is `Secure`, sign-in does not work over plain HTTP —
including over the LAN. It has to be tested through the real HTTPS domain.

```sh
cd server
npm ci
npm run build
npm run start        # or: npm run start:dev
npm run typecheck
```

`better-sqlite3` and `argon2` are native modules and need a compiler. In
practice they are built in CI inside the Docker image and never on the Pi.

## Layout

```
index.html          bento home page
projects.html       project index
project-*.html      one page per project
impressum.html      legal + Datenschutz
login.html          sign-in for the vault
admin.html          admin panel
vault/index.html    private document list — an empty shell, filled by the API
style.css           all styling, one file
script.js           shared behaviour, loaded by every page
admin.js            admin panel only
server/             the NestJS API
deploy/             nginx config and the Pi runbook
docs/               planning notes
```

## Projects on the site

- **ComfyUI × Krea 2** — a custom node-graph workflow built around Krea 2.
- **Ignite** *(WIP)* — a standalone reverse proxy in Rust that safely exposes a
  local LLM server (KoboldCpp, llama.cpp, Ollama) to the internet.
- **Kobui** — a local-only AI chat frontend in React for KoboldCpp.
- **Stalkr** — a real-time Minecraft server dashboard with RCON and NBT
  parsing, running on a Raspberry Pi 5.

## Deployment

The site runs on a Raspberry Pi behind nginx, reached through a Cloudflare
Tunnel. GitHub Actions builds the arm64 API image on pushes touching `server/`
and publishes it to GHCR; the Pi pulls it and never builds anything itself.
The static site is rsynced separately.

```sh
docker compose pull && docker compose up -d
```

The API is published to **loopback only** (`127.0.0.1:8080`) — without that
prefix Docker writes its own iptables rules and would put the service on the
LAN straight through the host firewall. nginx is the only thing that should
reach it.

The full runbook, including the irreversible DNS step, is in
[`deploy/README.md`](deploy/README.md).

## What is not in this repo

This repository is public, so by design it contains no secrets, no database
and no vault documents. The private documents live outside the web root at
`/var/lib/kira1q/vault-files/` on the Pi and are streamed only after a session
check — nginx cannot serve them even if a location block is misconfigured.

The vault page does not name its documents either. The list is fetched from
the API after authentication, so an unauthenticated visitor receives a page
with nothing in it rather than one that reveals what exists.
