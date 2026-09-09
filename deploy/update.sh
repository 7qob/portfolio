#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# kira1q.dev — update a running Pi.
#
#     ~/Portfolio/deploy/update.sh              both halves
#     ~/Portfolio/deploy/update.sh --static     the site only
#     ~/Portfolio/deploy/update.sh --api        the container only
#
# Or from the desktop, without logging in first:
#
#     ssh ubuntu@192.168.0.56 '~/Portfolio/deploy/update.sh'
#
# What this replaces: dragging the whole tree over in WinSCP, running
# setup-pi.sh (which reinstalls nginx every time to copy some files), and then
# remembering that the API is a separate `docker compose pull` in a different
# directory. Three manual steps in two windows, with nothing checking the
# result.
#
# The repository is public, so `git pull` here needs no key, no token and no
# secret on the Pi. That is the whole trick: the Pi becomes an ordinary
# checkout that can say what it is running, instead of a directory that
# something was copied into at some point.
#
# Safe to re-run. Nothing here touches the database, the vault files, the
# published pages or the uploads.
# ---------------------------------------------------------------------------
set -euo pipefail

REPO="${REPO:-$HOME/Portfolio}"
WEBROOT="${WEBROOT:-/var/www/kira1q.dev}"
BRANCH="${BRANCH:-main}"

DO_STATIC=1
DO_API=1

for arg in "$@"; do
  case "$arg" in
    --static) DO_API=0 ;;
    --api)    DO_STATIC=0 ;;
    -h|--help) sed -n '2,26p' "$0"; exit 0 ;;
    *) echo "!! Unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done

step() { printf '\n==> %s\n' "$1"; }

# ---- 1. Get the new code --------------------------------------------------

if [ ! -d "$REPO/.git" ]; then
  cat >&2 <<EOF
!! $REPO is not a git checkout.

   It is probably the WinSCP upload. Replace it with a clone once, and every
   update after this is a single command:

       mv $REPO ${REPO}.winscp
       git clone https://github.com/7qob/Portfolio.git $REPO
       $REPO/deploy/update.sh

   Nothing on the Pi that matters lives in that directory: the database, the
   vault files, the published pages and the uploads are all outside it.
EOF
  exit 1
fi

step "Fetching $BRANCH"
BEFORE=$(git -C "$REPO" rev-parse HEAD)

# --ff-only rather than a plain pull. If somebody edited a file on the Pi this
# stops and says so, instead of opening a merge in whatever $EDITOR is set to
# and leaving the checkout half-way through a deploy.
git -C "$REPO" fetch --quiet origin "$BRANCH"
if ! git -C "$REPO" merge --ff-only "origin/$BRANCH" --quiet; then
  echo "!! Cannot fast-forward. The checkout has local changes:" >&2
  git -C "$REPO" status --short >&2
  echo "   Fix or discard them (git -C $REPO checkout -- .) and run this again." >&2
  exit 1
fi

AFTER=$(git -C "$REPO" rev-parse HEAD)

if [ "$BEFORE" = "$AFTER" ]; then
  echo "    Already at $(git -C "$REPO" rev-parse --short HEAD). Nothing new to pull."
else
  echo "    $(git -C "$REPO" rev-parse --short "$BEFORE") -> $(git -C "$REPO" rev-parse --short "$AFTER")"
  git -C "$REPO" --no-pager log --oneline "$BEFORE..$AFTER" | sed 's/^/      /'
fi

CHANGED=$(git -C "$REPO" diff --name-only "$BEFORE" "$AFTER" || true)

# ---- 2. The static site ---------------------------------------------------

if [ "$DO_STATIC" = 1 ]; then
  step "Copying the site into $WEBROOT"
  "$(dirname "$0")/sync-site.sh" "$REPO" "$WEBROOT"

  # The server block is part of the repo, so it can change with a pull. Only
  # reload when it actually did: nginx -t on every deploy is noise, and a
  # reload nobody asked for is a reload nobody checked.
  if echo "$CHANGED" | grep -q 'deploy/nginx-kira1q.dev.conf'; then
    step "The nginx server block changed, installing it"
    sudo cp "$REPO/deploy/nginx-kira1q.dev.conf" /etc/nginx/sites-available/kira1q.dev
    sudo nginx -t
    sudo systemctl reload nginx
  fi
fi

# ---- 3. The API -----------------------------------------------------------

if [ "$DO_API" = 1 ]; then
  step "Pulling the API image"
  # A no-op when the digest already matches, so this is cheap to run every
  # time rather than something to remember to do after a server/ change.
  ( cd "$REPO" && sudo docker compose pull --quiet && sudo docker compose up -d )

  step "Waiting for the API to come back"
  for i in $(seq 1 30); do
    if curl -fsS -o /dev/null http://127.0.0.1/api/health; then
      echo "    healthy after ${i}s"
      break
    fi
    if [ "$i" = 30 ]; then
      echo "!! The API did not become healthy. Recent logs:" >&2
      ( cd "$REPO" && sudo docker compose logs --tail 40 api ) >&2
      exit 1
    fi
    sleep 1
  done

  # Old image layers pile up on a 256 GB SSD faster than you would think.
  # Dangling only: this never removes an image something could roll back to.
  sudo docker image prune -f >/dev/null
fi

# ---- 4. Say whether it worked ---------------------------------------------

step "Checking the live site"
fail=0
check() {
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1$1" || echo ERR)
  if [ "$code" = "$2" ]; then
    printf '    %-26s %s\n' "$1" "$code"
  else
    printf '    %-26s %s   <-- EXPECTED %s\n' "$1" "$code" "$2"
    fail=1
  fi
}

check /                     200
check /projects.html        200
check /about.html           200
check /style.css            200
check /vault/               200
check /no-such-page.html    404   # the site's own 404 page, not nginx's
check /api/health           200
check /api/vault/items      401   # the data behind the vault stays shut
check /api/admin/overview   401

# ---- 5. The one thing this cannot do for you ------------------------------

# A markup change in the renderer does not reach a visitor until Publish runs:
# the generated pages on disk were written by whichever renderer shipped
# before them. This is the single most common way a deploy looks finished and
# is not, so it gets said out loud rather than living in the README.
if echo "$CHANGED" | grep -qE 'server/src/projects/(render|blocks)\.ts'; then
  cat <<'EOF'

    ! The page renderer changed in this update.
      Every generated page on disk was written by the previous version, so
      the live project pages, the projects index and the home page still
      carry the old markup. Rewrite them from here:

          docker compose exec api node dist/cli.js render

      or open /admin.html and hit Publish, which does the same thing.
EOF
fi

echo
if [ "$fail" = 0 ]; then
  echo "==> Done. Running $(git -C "$REPO" rev-parse --short HEAD)."
else
  echo "==> Finished with failed checks above. Running $(git -C "$REPO" rev-parse --short HEAD)." >&2
  exit 1
fi
