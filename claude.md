# CLAUDE.md — kira1q.dev

## What this is

A personal portfolio site, plus a small private area for job applications.
It started as an empty scaffold; it is now a real site with real content and
a backend. This file used to describe the scaffold and was wrong on nearly
every point — if something here contradicts the code, the code is right and
this file should be fixed.

## Shape of the repo

```
index.html          bento home page
projects.html       project index
project-*.html      one page per project (hand-written; the admin panel can
                    also publish generated ones — see "Project pages from
                    the admin panel" below)
impressum.html      legal + Datenschutz (school requirement)
login.html          sign-in for the vault
admin.html          admin panel (admins only)
vault/index.html    private document list — an empty shell, filled by the API
style.css           all styling, one file
script.js           shared behaviour, loaded by every page
admin.js            admin panel only
edit.js             the on-page editor — in no page's markup; script.js
                    injects it for an admin only (see "Sections" below)
server/             NestJS + TypeScript API (see below)
deploy/             nginx config and Pi deployment notes
docs/               planning notes
```

## Stack

**Front end: static HTML + CSS + JS. No framework, no build step, no bundler.**
That constraint still holds and is worth keeping — the site is ~50 KB and
opens from disk.

**Back end: NestJS + TypeScript in a Docker container**, added when the vault
moved from one shared Basic Auth password to per-person accounts. It is the
only part with a build step and dependencies.

The two halves are deliberately separable. `index.html`, `projects.html`,
`impressum.html` and the project pages are pure static and work
over `file://` or on GitHub Pages with no backend at all. Only the vault,
login and admin pages need the API, and each degrades to a plain message
rather than a broken screen when it is absent. **Keep it that way** — do not
introduce an API call into a page that does not need one.

## Design rules (unchanged, still binding)

- Retro, KISS, classic. Not soft, not rounded, no glassmorphism.
- Dark theme by default, light theme via the header toggle. Colours are
  CSS variables; only the primitives are overridden for light.
- **1px borders on every box. `border-radius: 0`. No box-shadows.** Depth
  comes from the border and the panel/background contrast, nothing else.
- Spacing off a single `--space` unit and `--gap`. Reading flow uses
  `--stack-lg` / `--stack-md` / `--stack-sm`; `--gap` is for grids.
- Serif type (`--font`). The type scale is sized for it.
- Visible `:focus-visible` states everywhere, not just `:hover`.
- Home page bento grid uses `grid-template-areas` and is height-locked to one
  screen on desktop; boxes scroll internally rather than the page. Overflow is
  **measured at runtime**, never assumed at author time.

### Subpage rules (project pages, about, impressum, projects index)

These three are what stop a subpage drifting back into the ragged, eight-
measure column it was before.

- **Two measures, never more.** Text is capped at `--measure`; only
  screenshots and tables reach `--measure-wide`. Do not put a `max-width` on
  an individual block — it inherits the right one already. If a page has more
  than two right edges, something added its own.
- **Every top-level block in an article is a band**: hairline along the top,
  `--stack-md` of air under it, `--stack-lg` to the next band. That is
  `.project__section`, `.project-row`, `.reveal`, `.figure`, `.datarow` and
  `.linklist`. The lede is the only block above the first seam.
- **The projects index is bands too, not cards.** One `.project-row` per
  project — seam, name, chips, blurb, corner arrow — on the same
  `--measure-wide` rail as a project page, so the list and the page it opens
  read as one document. The row's seam carries the project's own accent the
  way `.page-head--project` does. The old two-column `.project-grid` and its
  `is-wide` split are gone; cards live on the bento home page only.
- **Five type sizes, all from `--fs-*` tokens**: `--fs-name`, `--fs-subtitle`,
  `--fs-heading`, `--fs-lede`, `--fs-body`, plus `--fs-caption` for labels. A
  literal `rem` value in a rule is a bug.
- Order on a project page is fixed: title and chips in the head (identity),
  lede, the bands that explain it, then the repository link (reference), then
  the pager. A generated page uses the part of the catalogue that survived
  the rebuild — `.project__section`, `.reveal`, `.mediarow` and `.linklist`.
- `.reading` on a prose container is what supplies body line-height and inline
  link styling. Link lists and pagers are **siblings** of it, never children.

## Content rules

- No lorem ipsum, no invented projects, no stock images, no fake data.
- Do not invent personal details. The Impressum's Name / Kontakt / Ort fields
  are filled in by the owner and by nobody else: a name, a contact address and
  a place, and deliberately no street, postcode or phone number. The
  Datenschutz section is written, because that is a factual description of the
  system rather than personal data.
- No widgets needing a third-party backend (message board, map, Last.fm,
  Discord). The contributions graph is the one third-party call, it needs no
  token, and it degrades to cached or absent without breaking the page.

## The backend, in one paragraph

`server/` is a NestJS service behind nginx at `/api/`, holding a SQLite
database of accounts, sessions, login attempts, vault documents, downloads and
an audit log. Passwords are argon2id. Sessions are opaque random tokens stored
as SHA-256, in an `HttpOnly; Secure; SameSite=Lax` cookie. There is **no
secret anywhere in the service** — nothing is signed, so the image can be
public and the compose file has no credentials in it. Accounts are issued by
an admin and the password is generated server-side and shown exactly once.
Vault documents live in `/var/lib/kira1q/vault-files/` on the Pi, outside the
web root, and are streamed only after a session check.

## Project pages from the admin panel

The panel's **Projects** section is a small CMS for project pages. A project is
head fields plus a linear stack of blocks, stored as JSON in SQLite. There are
**two block types and there is no third**: `text` (a heading and paragraphs)
and `media` (a heading and rows of image/GIF/MP4, each with its own words).
Both carry `collapsible`, which wraps the band in the site's closed
`<details>`. `section`, `steps`, `features`, `table`, `figure`, `datarow`,
`files` and `links` were removed in the rebuild — a project page is a
description, some words and some pictures.

**Publish** writes **three** things server-side (`server/src/projects/
render.ts`): `project-<slug>.html` per published project, a regenerated
`projects.html`, and `index.html` — the home page. Pagers are derived from
`sort_order`, so neighbouring pages re-render on every publish and the chain
never goes stale. `projectRow()` renders the index, `projectCard()` renders the
home page's cards, and they are separate on purpose — the index is bands, the
home page is `.card` rows.

The home page is a **splice, not a render**. `renderHome()` reads the template,
replaces the region between `<!-- projects:start -->` and `<!-- projects:end -->`
with one `<article class="card">` per placed project, and touches nothing else.
Everything else in `index.html` is hand-written and never parsed. Its base is
`PAGES_DIR/index.html` if one exists, else `HOME_TEMPLATE`.

`projectCard()` emits the single-page card — `.shot--empty` rail, `.card__head`,
`.card__desc`, and a `.card__links` repo link when there is a `repoUrl` — so a
generated card is the same markup as the hand-written ones beside it. It carries
**no accent**: `.card` has no `--edge-brand` hook, so a project's colour shows on
its own page and on the projects index, not on the home page. The old bento cell
(`.box--edge`, `area-*`) and the `data-projects` count are gone with the grid.

A project's colour is **one `#rrggbb` in the `accent` column**, emitted as
`class="… is-custom" style="--edge-brand:…"`. The four `.is-comfy` /
`.is-ignite` / `.is-kobui` / `.is-stalkr` palettes are gone; `.is-custom`
derives the shade and tint with `color-mix`, per theme. Adding a project is no
longer a stylesheet edit, and that is the whole point — do not reintroduce a
named palette.

Whether a project appears on the home page, and in what order, is `home_slot`
(`feature` | `tall` | `smallA` | `smallB`), unique among non-NULL values by
index. Assigning an occupied slot **swaps** the two projects. Since the home
page is a linear list, the names no longer point at grid cells — they are only
a fixed sort key, read in the order above. A NULL `home_slot` keeps the project
off the home page while leaving it on the projects index.

Rules the implementation enforces — keep them enforced:

- **Generated pages make zero API calls.** They are ordinary static files
  that work over `file://`, exactly like the hand-written ones. Authoring
  touches the API; the published page never does.
- **The renderer emits only markup that style.css already styles.** A new
  block type that needs a new CSS rule is a design change, not a feature. The
  target output is `docs/preview-project-sample.html`, which is the spec: the
  renderer reproduces it tag for tag, and if the two disagree one of them is
  wrong.
- **The one style attribute is a regex-validated hex.** `accent` is checked in
  the DTO on the way in and again in the renderer on the way out, because
  there is a database between those two moments.
- **Everything the form sends is escaped before it reaches a page.** The only
  inline markup is `[text](url)` and `` `code` ``, applied after escaping,
  with hrefs checked against an allowlist. No raw HTML from the form, ever.
- **Uploads are content-addressed.** The panel can upload media
  (PNG/JPEG/WebP/GIF/MP4/JSON/PDF, magic bytes verified server-side); files
  are stored as `<sha256[0:16]>.<ext>` under `MEDIA_DIR` and served from
  `assets/up/`. The client never chooses a filename. Vault documents are
  separate: the Documents tab creates items and uploads their PDFs
  (magic-byte checked, stored as `<slug>.pdf` under `VAULT_FILES_DIR`, which
  is therefore mounted rw); WinSCP to the Pi remains only as a fallback.
- Image/video dimensions are measured in the browser before upload and become
  the `width`/`height` attributes; the `reveal` band's "N clips · X MB" hint
  is computed from real sizes, never typed.

The four original `project-*.html` files are still on disk and still answer
their URLs, but nothing links to them any more: the home page's cards, the
projects index and the pagers all come from the database. They are kept so old
links do not break, and they are the one place the pre-rebuild markup can
still be read. They carry no accent — the palette classes they name no longer
exist — so they wear the site accent.

`index.html` and `projects.html` are rsynced as before, but nginx serves the
generated copies first for those two URLs (`location = /` in
`deploy/nginx-kira1q.dev.conf`); the rsynced ones are the template and the
never-published fallback.

## Sections, edited on the page itself

The home page's own writing — the hero, and the ledes of about, setup and
readme — is a second small CMS, and it is driven from `index.html` rather than
from the panel. Signed in as an admin, a pen appears in the top-right of each
editable section; clicking it swaps that section's content for EN/DE fields in
place, at the same measure and in the same type as the words it replaced.

It is the projects splice again, not a new mechanism. Each region is a marker
pair named after the section id:

```html
<section class="section" id="about" data-edit="about">
  <div class="split">…</div>
  <!-- section:about:start -->
  <div class="region" data-region="about">…</div>
  <!-- section:about:end -->
  <ul class="facts">…</ul>
</section>
```

`spliceRegion()` in `server/src/projects/render.ts` is the shared primitive;
`renderHome()` and `SectionsService.renderHome()` are its two callers. They
compose without knowing about each other because both read the generated
`index.html` back as their own template and a splice keeps every marker it did
not come for — so whichever runs last still has the other's region in front of
it. Both write through `server/src/site/pages.ts`, which is the single
filename allowlist.

Rules the implementation enforces — keep them enforced:

- **`live_blocks IS NULL` means "leave that region alone".** Before a section's
  first Publish the hand-written markup between its markers is what ships. That
  is what makes the table safe to create on a running Pi.
- **Save is not Publish.** Save writes `draft_blocks` and touches no file; the
  live page keeps showing `live_blocks` until Publish. The pen carries a dot
  while a draft is ahead of the page.
- **An element carrying `data-de` must be plain text.** `initLang()` captures
  `data-en` from `textContent` and swaps `textContent`, so markup inside a
  translated element is destroyed the first time someone presses DE. The
  renderer therefore escapes a paragraph that has a German twin and only runs
  `inline()` — the `` `code` `` / `[label](url)` mini-markdown — on one that
  does not. Do not emit `data-de` on a paragraph that went through `inline()`;
  it looks right until the language changes.
- **The editor seeds itself from the page, reading `data-en`, never
  `textContent`.** On a page already toggled to German `textContent` *is* the
  German, and reading it would translate the site into German twice and lose
  the English.
- **The `.region` wrapper is always emitted, even empty.** It is the handle
  `edit.js` grabs; a section emptied to nothing would otherwise publish itself
  out of reach of the pen that emptied it.
- **`edit.js` is in no page's markup.** `script.js` injects it only for someone
  whose sign-in came back with `role === "admin"`, or on `?edit` / `#edit`. A
  visitor downloads nothing extra and makes no extra request, which is how
  "a published page calls no API" stays true. The flag is a hint about who is
  looking; the gate is `/auth/me` and the guards on every route.
- **Only prose so far.** `text` and `heading`, on `top`, `about`, `setup` and
  `readme` — the `SECTION_KEYS` registry in `server/src/sections/blocks.ts` is
  the whole list, because every key must match a marker pair a human put in the
  page. The `.facts` lists, the `.rig` clips, the README block and `#contact`'s
  `.soc` rows are still hand-written.

## Comments

The front end carries **few comments on purpose**. What stays is what you would
have to guess at while changing a value: the token annotations in `:root`, the
knobs (`--edge-mix`, `data-projects`, the gradient's angle and stops, the fixed
20rem `.mediarow` rail), the traps (a `minmax(0,1fr)` floor breaking the desktop
lock, an undefined gradient stop voiding the border), and the invariants
(escaping in `render.ts`, the vault list being empty for a reason). What went is
the archaeology — how a rule used to look and why it changed. Do not restore it;
that is what `git log` is for. New comments follow the same test: would someone
adjusting this line get it wrong without you.

## Things that will bite you

- **The repo is public.** No secret, no database, no vault document may ever
  be committed. A commit is permanent even if a later commit deletes the file.
- **Pages authored in the panel live only in the SQLite database on the Pi** —
  and so do the home page's project cards, and now the home page's own prose.
  For them, `git clone` is no longer a complete backup of the site's content.
  Treat authored content as existing in exactly one place; the file under
  `PAGES_DIR` is output, not a copy of the source.
- **The rsynced `index.html` is the bootstrap template, markers and all.** Drop
  a `<!-- section:*:start -->` / `:end` pair from it by hand and Publish for
  that section silently stops working — the renderer logs a warning and skips
  the region rather than failing the whole write.
- **The vault page must not name its documents.** The list comes from the API
  after authentication. It was hardcoded once, which told anyone who viewed
  source what documents existed. Do not put it back. There is a check for this
  in `deploy/README.md` §3.6.
- **In the admin panel, use `textContent`, never `innerHTML`.** It displays
  user-agent strings and usernames from failed logins — attacker-chosen text
  the server stored verbatim, as it should.
- **`Secure` cookies mean login does not work over plain HTTP**, including
  `http://192.168.0.56/` on the LAN. Test through `https://kira1q.dev`.
- **Native modules.** `better-sqlite3` and `argon2` need a compiler. They are
  built in CI inside the Docker image and never on the Pi — and they will not
  install on a Node version without prebuilds unless Python is present.
- **Commits carry no AI attribution.** Author is `7qob`, no
  `Co-Authored-By` trailer, no mention of Claude anywhere.
- **A markup change in the renderer needs a Publish to take effect.** The
  generated `projects.html` on the Pi was written by the renderer that shipped
  before it. After deploying the band-list index, publish once so the live page
  stops asking for `.project-grid`, which no longer exists in `style.css`.

## Deployment

GitHub Actions builds the arm64 image on pushes touching `server/` and
publishes to GHCR. The Pi pulls it. The static site is rsynced separately.
Full runbook in `deploy/README.md`.
