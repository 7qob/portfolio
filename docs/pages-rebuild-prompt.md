# Implementation prompt — Pages CMS rebuild

Paste the block below into a fresh Claude Code session in `S:\Sessions\Website\Portfolio`.
It is written to be executed without re-exploring the repo: every file it needs is named,
and the two preview files are the spec.

---

Implement the Pages CMS rebuild. The plan is at
`C:\Users\matti\.claude\plans\can-you-redo-the-woolly-brooks.md` — read it first, follow it,
and do not re-plan.

**Two preview files are the specification. Do not re-derive their design.**

- `docs/preview-project-sample.html` — the exact markup `render.ts` must emit. Match its
  structure element for element (paths differ: published pages use bare `style.css` and
  `assets/up/<hash>.<ext>`).
- `docs/preview-admin-pages.html` — the admin panel's four sections and the editor. Its
  `<style>` block is finished CSS: move it into the admin section of `style.css`
  unchanged, except `.is-custom`, which replaces the four `.is-*` palettes near
  `style.css:944`. Its `<script>` block has a working colour picker and the
  reveal/fold/layout handlers — port them, don't rewrite them.

**Read only these, and only the ranges given.** The codebase has been surveyed; broad
exploration is wasted tokens.

- `server/src/projects/` — `blocks.ts`, `render.ts`, `projects.service.ts`,
  `projects.controller.ts`, `dto.ts` (all of them; they are the work)
- `server/src/db/migrations.ts:130-185` — the `projects` and `media` tables
- `server/src/config.ts:55-70` — `pagesDir` / `mediaDir`
- `admin.html:54-63` (tab strip) and `:139-168` (Pages panel)
- `admin.js:546-1420` (the whole Pages section)
- `style.css:602-640` (bento), `:865-960` (`.box--edge` + palettes), `:1428-1640` (admin),
  `:2097-2330` (reveal + mediarow)
- `index.html:53-235` (the bento's cells)

## Order of work

Commit after each numbered step, so a bad step is one `git revert`.

**1 — Model.** `blocks.ts`: the union becomes exactly two types.

```ts
type Block =
  | { type:'text';  heading:string; body:string[]; collapsible:boolean }
  | { type:'media'; heading:string; collapsible:boolean;
      rows:{ mediaId:string; alt:string; title:string; body:string[];
             layout:'beside'|'below' }[] }
```

Delete `section|steps|features|table|figure|datarow|files|links` from the union, the
normalizers and the interfaces. Keep `LIMITS`, `SAFE_HREF`, `collectMediaIds`,
`normalizeChips` and the `BlockError`→400 behaviour as they are.

New migration: add `home_slot TEXT NULL`, `repo_url TEXT NULL`, `accent TEXT`; drop
`palette` usage; `CREATE UNIQUE INDEX ... ON projects(home_slot) WHERE home_slot IS NOT NULL`;
and `UPDATE projects SET blocks='[]'` where the JSON contains a removed type, so no stored
draft can 400 the editor forever.

`dto.ts`: `homeSlot` (`IsIn` the four names, nullable), `repoUrl` (0-200, must match
`^https://github\.com/`), `accent` (must match `^#[0-9a-f]{6}$`, case-insensitive). Drop
`palette`. `blocks` stays a bare `@IsArray` — `blocks.ts` is the structural gate.

**2 — Renderer.** `render.ts`:

- One `band(heading, inner, collapsible, hint?)` helper replaces the per-type functions.
  `collapsible:false` → `<section class="project__section">` + `h2.section-label`;
  `true` → the `<details class="reveal">` shell. Media bands keep the computed
  `N clips · X MB` hint via the existing `formatBytes`; text bands emit no hint.
- Media rows: `layout:'beside'` → `.mediarow`, `'below'` → `.mediarow--wide`. MP4 keeps
  `CLIP_CONTROLS` and the `data-clip-*` hooks `script.js:133` drives; images stay a bare
  lazy `<img>`.
- Accent: emit `is-custom` plus `style="--edge-brand:<hex>"` on the card and the page
  head. Validate the hex again here — never interpolate a form value into a style
  attribute on the DTO's word alone.
- Repo link: a single-item `.linklist` after `</article>`, before the pager, heading
  "Source". Omitted when `repo_url` is empty.
- New `renderHome()`: read `PAGES_DIR/index.html`, else the static `index.html` (new
  `homeTemplate` in `config.ts`). Replace exactly two things — the region between
  `<!-- projects:start -->` and `<!-- projects:end -->`, and the `data-projects="N"`
  attribute on `<main class="bento" …>` via an anchored regex. Touch nothing else.
- `projects.service.ts`: add `index.html` to `PAGE_NAME` (`:63`); call `renderHome()` from
  `renderAllPublished()` (`:264`) through the existing `writePage()` tmp+rename path.
  Assigning an occupied `home_slot` swaps the two projects rather than erroring.

**3 — Static site.** `index.html`: delete the four hand-written project `<section>`s,
insert the marker pair, set `data-projects="0"`. `style.css`: the bento area map at `:621`
becomes five maps keyed `[data-projects="0".."4"]` with the areas renamed
`feature/tall/smallA/smallB`; rename `.area-comfy` etc. to match; check the breakpoints at
`:2864` and `:2942` and collapse the variants there if they already stack to one column.
The four `project-*.html` files stay on disk, unlinked — do not delete them.

**4 — Panel.** `admin.html`: the eight tabs become four — Projects, Home page, Files,
Access — each with a `<small>` subtitle, per the preview. Files holds uploads + vault
documents; Access holds the overview stats, accounts, and Logins/Sessions/Downloads/Audit
behind a nested `.admin-tabs` strip. Reuse the existing `data-panel` + `hidden` switching.

`admin.js`: rebuild `buildProjectEditor()` (`:868`) as the page-shaped column in the
preview. Slug auto-derives from the title while unpublished. Create takes only a Title.
`mediaPicker` (`:744`) gains a thumbnail, dimensions and size. Row layout defaults from
the mime (`video/mp4` → `below`, else `beside`), overridable per row. Home placement lives
in the Home page section, not the editor; the editor links to it. Add an unsaved-changes
guard on Back and on section switch.

## Non-negotiables

- **Generated pages make zero API calls** and work over `file://`.
- **The renderer emits only markup `style.css` already styles.** A block needing a new CSS
  rule is a design change, not a feature.
- **Everything from the form is escaped before it reaches a page.** Inline markup is
  `[text](url)` and `` `code` `` only, applied after escaping, hrefs allowlisted. The one
  style attribute is a regex-validated hex.
- **In the panel, `textContent`, never `innerHTML`** — it renders attacker-chosen strings.
- **Nothing secret is committed.** The repo is public.
- **Commits: author `7qob`, no `Co-Authored-By`, no mention of Claude.**

## Verify before reporting done

1. `cd server && npm run build` — clean, with the removed block types gone.
2. Launch config `portfolio-full` (:8124). Create a project from a Title alone; add a text
   band, an image band (beside), a folded GIF band and a video band (below); set a repo URL
   and an accent; assign the Feature cell; Preview; Publish.
3. In `PAGES_DIR`: `project-<slug>.html`, `projects.html`, and `index.html` carrying one
   card in `area-feature` with `data-projects="1"`.
4. Open the generated page over `file://` — renders fully, **zero network requests**, clip
   controls and fold both work.
5. Publish a second and third, swap two cells, unpublish one: the count, the area map and
   the pager chain all follow, and no duplicate-slot state is reachable.

Report what you verified with the actual output. If a step is blocked, finish every other
step and say plainly what you left and why.
