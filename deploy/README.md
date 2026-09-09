# Deploying kira1q.dev to the Raspberry Pi

Two halves. **Part 1 is reversible** — it only sets up the Pi, and your live
site keeps running on GitHub Pages the whole time. **Part 2 moves the domain**
and takes it away from Pages.

Do Part 1, check the site on your LAN, and only then do Part 2.

---

## Part 1 — Serve the site on the Pi (safe)

Files are already at `/home/ubuntu/Portfolio/` from WinSCP. Upload this
`deploy/` folder alongside them, then over SSH:

```bash
cd ~/Portfolio/deploy && chmod +x setup-pi.sh && ./setup-pi.sh ~/Portfolio
```

That installs nginx, copies the site to `/var/www/kira1q.dev` (skipping the
dev-only files), installs the server block and prints a check. When it
finishes, open `http://192.168.0.56/` from your desktop.

**Nothing about kira1q.dev has changed yet.** Take your time here.

### Updating the site later

**One command, and it does both halves:**

```bash
~/Portfolio/deploy/update.sh
```

Or from the desktop, without logging in first:

```bash
ssh ubuntu@192.168.0.56 '~/Portfolio/deploy/update.sh'
```

It pulls the repository, copies the site into the web root, pulls the API
image if there is a new one, waits for the container to report healthy, and
then checks nine URLs and tells you if any of them answered wrong. `--static`
and `--api` do one half only.

#### Make `~/Portfolio` a git checkout first

This replaces WinSCP, and it is the part worth doing once:

```bash
mv ~/Portfolio ~/Portfolio.winscp
git clone https://github.com/7qob/Portfolio.git ~/Portfolio
~/Portfolio/deploy/update.sh
```

The repository is public, so this needs no key, no token and no secret stored
on the Pi. Nothing that matters lives in `~/Portfolio` either: the database,
the vault files, the published pages and the uploads are all outside it, which
is why swapping the directory is safe. Once you have watched one update work,
`rm -rf ~/Portfolio.winscp`.

Two things this fixes beyond the typing. A checkout can answer *what is
actually deployed* (`git -C ~/Portfolio log -1`), which a directory that was
copied into cannot. And a `git checkout` on Linux writes LF line endings,
where a WinSCP binary-mode copy of a Windows working tree hands the Pi shell
scripts full of carriage returns.

#### The rsync, if you ever need it by hand

Don't retype it. `deploy/sync-site.sh` is the exclude list, and it is the only
copy of it in the repo on purpose:

```bash
~/Portfolio/deploy/sync-site.sh ~/Portfolio /var/www/kira1q.dev
```

`/pages/` and `/assets/up/` are what the admin panel writes into and they are
not in the repo, so a `--delete` missing those two lines wipes every published
project page and every upload. The script also hands both directories back to
uid 1000 after the recursive `chown`, which publishing needs and which a bare
rsync does not do.

`setup-pi.sh` still exists and still works, but it is the *first-run* script:
it installs nginx and creates directories every time, which an update does not
need.

`index.html` and `projects.html` are deliberately **not** excluded. They are
rsynced as before, but they are no longer the pages visitors get once anything
has been published: nginx serves `/pages/index.html` and `/pages/projects.html`
first for those two URLs (the `location = /` blocks in the server config), and
the rsynced copies are the template the renderer splices project cards into
plus the fallback for a Pi that has never published. Overwriting them is
therefore how you update the template, which is what you want — the generated
copies live in `pages/`, which `--delete` still cannot touch.

The compose file mounts the rsynced `index.html` into the container read-only
as `HOME_TEMPLATE`. If you moved the webroot, move that mount with it.

---

## Part 2 — Cloudflare Tunnel (this moves the domain)

A Tunnel makes the Pi reachable from the internet **without** port forwarding
and without exposing your home IP: `cloudflared` dials *out* to Cloudflare and
holds the connection open. This is the same mechanism Ignite automates.

### 2.1 Install cloudflared

```bash
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt-get update && sudo apt-get install -y cloudflared
```

### 2.2 Log in

```bash
cloudflared tunnel login
```

Prints a URL. Open it **on your desktop**, pick `kira1q.dev`, authorise. This
is yours to do — it's an account login and I can't and shouldn't do it for you.

### 2.3 Create the tunnel

```bash
cloudflared tunnel create kira1q
```

Note the tunnel UUID it prints; credentials land in
`/home/ubuntu/.cloudflared/<UUID>.json`.

### 2.4 Configure it

Create `/home/ubuntu/.cloudflared/config.yml` — replace `<UUID>`:

```yaml
tunnel: <UUID>
credentials-file: /home/ubuntu/.cloudflared/<UUID>.json

ingress:
  - hostname: kira1q.dev
    service: http://localhost:80
  - hostname: www.kira1q.dev
    service: http://localhost:80
  - service: http_status:404
```

### 2.5 Point DNS at the tunnel — ⚠️ the irreversible step

```bash
cloudflared tunnel route dns kira1q kira1q.dev
cloudflared tunnel route dns kira1q www.kira1q.dev
```

**This overwrites the DNS records that currently send kira1q.dev to GitHub
Pages.** Your Devportal stops being served at that domain the moment it
propagates.

Before running it, in the Cloudflare dashboard (DNS → Records) **screenshot or
copy the existing records for `kira1q.dev` and `www`.** That is your only way
back. Reverting means re-entering those records by hand.

The Devportal repo itself is untouched — it stays at
`7qob.github.io/Devportal` and you can always re-point DNS to it.

### 2.6 Run it as a service

```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
systemctl status cloudflared --no-pager
```

### 2.7 Verify

```bash
curl -I https://kira1q.dev
```

You want `HTTP/2 200` **without** the `x-github-request-id` header — that
header's absence is how you know you're hitting the Pi and not Pages.

---

## Part 3 — The Vault (private documents)

The vault is behind a real login: per-person accounts in a SQLite database,
served by a small containerised API. This replaced HTTP Basic Auth, which had
one shared password, no way to revoke it for one person, and no record of who
opened anything.

**Do Part 1 first.** Over `file://` or on GitHub Pages the vault page is an
empty shell with no backend to ask, and it says so.

### 3.1 Install Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
```

Log out and back in for the group to take effect.

### 3.2 Create the directories the container mounts

These live outside the web root deliberately. nginx serves `/var/www`; it has
no access to these, so a location-block mistake cannot expose a document.

```bash
sudo mkdir -p /var/lib/kira1q/data /var/lib/kira1q/vault-files
sudo chown -R 1000:1000 /var/lib/kira1q
sudo chmod 700 /var/lib/kira1q/data /var/lib/kira1q/vault-files
```

`1000:1000` is the `node` user inside the image. The container runs as that
user, not root, so a bug in the file-streaming path is contained.

The panel's two writable directories are the exception to "outside the web
root" — they hold public pages and public images, so they belong under
`/var/www` where nginx can serve them:

```bash
sudo install -d -o 1000 -g 1000 -m 755 /var/www/kira1q.dev/pages
sudo install -d -o 1000 -g 1000 -m 755 /var/www/kira1q.dev/assets/up
```

`755`, not `700`: uid 1000 writes them and `www-data` has to read them.
Create them **before** the first `docker compose up -d`. A bind mount whose
source directory does not exist is created by Docker as `root:root`, and the
container — running as uid 1000 — then fails every publish and every upload
with `EACCES`. `setup-pi.sh` does this for you.

### 3.3 Start the API

```bash
cd ~/Portfolio
docker compose pull
docker compose up -d
docker compose logs -f api    # ctrl-c once you see "Listening on"
```

The image is built for arm64 by GitHub Actions and pulled from GHCR — the Pi
never compiles anything, which is the whole reason this is a container.

Check it is alive:

```bash
curl -s localhost:8080/api/health
```

### 3.4 Install the nginx changes

```bash
sudo cp deploy/nginx-kira1q.dev.conf /etc/nginx/sites-available/kira1q.dev
sudo cp deploy/nginx-conf.d-kira1q.conf /etc/nginx/conf.d/kira1q-ratelimit.conf
sudo nginx -t && sudo systemctl reload nginx
```

The second file is the rate-limit zone. If you skip it, comment out the two
`limit_req` lines in the `/api/` block or `nginx -t` will fail.

### 3.5 Create your admin account

This is the one operation that cannot be authenticated — accounts are issued
from the admin panel and reaching the panel needs an account. It requires a
shell on the Pi, which is the right bar for it.

```bash
docker compose exec api node dist/cli.js create-admin kira
```

It prints a generated password **once**. Only its argon2id hash is stored, so
nobody — including you — can read it back. Put it in your password manager
before closing the terminal. If you lose it:

```bash
docker compose exec api node dist/cli.js reset-password kira
```

Everything after this is done in the browser at `/admin.html`.

### 3.6 Verify the gate before trusting it

```bash
curl -s -o /dev/null -w 'items:      %{http_code}\n' localhost/api/vault/items
curl -s -o /dev/null -w 'file:       %{http_code}\n' localhost/api/vault/items/1/file
curl -s -o /dev/null -w 'admin:      %{http_code}\n' localhost/api/admin/overview
curl -s -o /dev/null -w 'old path:   %{http_code}\n' localhost/vault/files/cv.pdf
curl -s              -w '\nvault page bytes above\n' localhost/vault/index.html | grep -ci 'curriculum\|zeugnis'
```

Wanted: **401, 401, 401, 404**, and **0** matches on the last one — the vault
page must not name a single document before you have signed in. That last
check is the one worth repeating after any change to `vault/index.html`,
because it is the property the old setup did not have.

### 3.7 Upload the documents

Through the admin panel: **Documents** tab → pick the PDF on the item's row.
The service checks the bytes are a real PDF, stores it as `<slug>.pdf` under
`/var/lib/kira1q/vault-files/`, and the row flips from "missing" to its size.
New document (a fresh semester's report): create it with the form above the
table, then upload onto the new row. Re-uploading replaces the file in place.

For this to work the compose file mounts vault-files **read-write** (it was
`:ro` before the panel could upload) and the directory must be owned by
uid 1000 — `setup-pi.sh` already does that (`chown 1000:1000`, mode 700).

The by-hand fallback still works if the panel is ever unreachable — WinSCP
into `/var/lib/kira1q/vault-files/`, **not** into `/var/www`, **not** into
`~/Portfolio`, and never into the git repo:

```bash
sudo chown 1000:1000 /var/lib/kira1q/vault-files/*
sudo chmod 640 /var/lib/kira1q/vault-files/*
```

A document whose file is absent shows as "Not uploaded" in the vault rather
than a broken download, which is also how you tell a failed upload from a
successful one.

If you are migrating from the old setup, delete the copies under the web root
once the new ones work:

```bash
sudo rm -rf /var/www/kira1q.dev/vault/files
```

### 3.8 Updating later

Both halves, one command:

```bash
~/Portfolio/deploy/update.sh
```

One half only, when you know which one changed:

```bash
~/Portfolio/deploy/update.sh --static     # site files, and nginx if its conf changed
~/Portfolio/deploy/update.sh --api        # pull the image and restart the container
```

The database and the documents are bind mounts, so pulling a new image never
touches accounts, logs or PDFs.

**A renderer change needs a re-render.** Every generated page on disk was
written by whichever renderer shipped before it, so a markup change in
`server/src/projects/render.ts` does not reach a visitor until something
rewrites the pages. From the shell you already have open:

```bash
docker compose exec api node dist/cli.js render
```

It rewrites every published project page, the projects index and the home
page from the database, publishes nothing new and changes no row, so running
it twice costs nothing. The panel's Publish button does the same thing
through `POST /api/admin/projects/render`; the command exists so that
finishing a deploy does not require signing into a browser.

`update.sh` notices when the renderer was in the pull and prints the command
at the end, because this is the way a deploy most often looks finished and is
not.

If the live index ever shows the projects as a plain bulleted list with no
cards and no covers, this is what happened: the pages on disk predate the
rebuild that replaced `.project-row` with `.project-card`, and the classes
they ask for are no longer in `style.css`. One `render` fixes it.

### What this protects against, and what it doesn't

| | |
|---|---|
| Search engines, scrapers, someone guessing the URL | Yes — 401 before a byte is sent, and the page itself names no document. |
| Learning what documents exist without logging in | Yes, and this is new. The list used to be hardcoded in the HTML; it now comes from an endpoint that requires a session. |
| Cloudflare's edge cache leaking a PDF | Handled: the API sends `Cache-Control: no-store, private`, and so does the nginx block in front of it. `.pdf` is cached by extension by default, so this is doing real work. |
| Someone you gave access to keeping it | Disable their account in the admin panel. Their sessions end immediately. This is the thing one shared password could not do. |
| Knowing who opened your grades | Every download is logged with the account, time and address, and shown in the panel. |
| Brute force | Rate limited per address and per username, with a lockout, plus a second limit at nginx. The lockout is derived from the database, so restarting the container does not clear it. |
| Reading a password off the wire | Fine over the tunnel (HTTPS to Cloudflare's edge). The session cookie is `Secure`, which means **login does not work over plain `http://192.168.0.56/`** — the browser will not send the cookie. Test through `https://kira1q.dev`. |
| Someone with a shell on the Pi | No. They can read the database and reset accounts. That is inherent to self-hosting. |
| The Pi being off | The vault and admin panel are down. The static site is too, but that was already true. |

---

## Cloudflare dashboard settings worth setting

- **SSL/TLS → Overview → Full.** Not "Flexible" (breaks nothing here but is bad
  practice) and not "Full (strict)" (the Pi has no cert — the Tunnel is already
  encrypted end to end, so Full is correct).
- **Speed → Auto Minify:** leave off. The site is 50 KB and minification has
  bitten this project already via caching.
- **Caching → Configure → Browser Cache TTL:** "Respect Existing Headers", so
  the nginx `Cache-Control` rules actually apply.

---

## Trade-offs you're accepting

| | |
|---|---|
| Uptime | Your Pi and your home internet. Router reboot = site down. |
| Speed | Cloudflare caches at the edge, so visitors mostly won't notice. |
| Maintenance | `apt upgrade` on the Pi is now your job. |
| Upside | You run the infrastructure your own project (Ignite) automates. |

If it ever becomes a hassle, pointing DNS back at GitHub Pages is a five-minute
change in the Cloudflare dashboard.
