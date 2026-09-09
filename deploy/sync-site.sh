#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# kira1q.dev — copy the checkout into the web root.
#
#     ./sync-site.sh [SOURCE] [WEBROOT]
#
# This exists as its own file for one reason: the exclude list below is the
# most dangerous thing in the repo, and it used to be written out once inside
# setup-pi.sh. A second copy in an update script would be a second copy of
# --delete with a slightly different set of exclusions, and the first time the
# two drifted it would take somebody's CV or every published page with it.
# One list, two callers.
#
# Called by setup-pi.sh (first run) and update.sh (every run after).
# ---------------------------------------------------------------------------
set -euo pipefail

SRC="${1:-$HOME/Portfolio}"
WEBROOT="${2:-/var/www/kira1q.dev}"

if [ ! -f "$SRC/index.html" ]; then
  echo "!! No index.html in $SRC" >&2
  exit 1
fi

if [ ! -d "$WEBROOT" ]; then
  echo "!! $WEBROOT does not exist. Run setup-pi.sh first." >&2
  exit 1
fi

echo "==> Copying site (dev-only files excluded)"
# --exclude 'vault/files/' is a safety line, not a tidiness one. Your CV and
# Zeugnisse are uploaded straight to the Pi and are deliberately NOT in the
# repo, so without this exclusion `--delete` would see them as files that no
# longer exist in the source and wipe them on every single deploy.
#
# server/, docs/ and docker-compose.yml are excluded for the same reason as
# deploy/: they are how the site is built and run, not part of what it serves.
# The API is reached through the /api/ proxy, never as files under the root.
#
# /pages/ and /assets/up/ are the same class of exclusion as vault/files/ and
# for the same reason, only worse: they exist on the Pi and nowhere else. They
# are not in the repo, so `--delete` sees them as files that no longer exist in
# the source and would wipe every published page and every upload on the next
# deploy. Both are anchored with a leading slash — they mean these exact
# directories at the web root, not any directory anywhere called "up".
#
# index.html and projects.html are NOT excluded, and that is deliberate. Both
# now have a generated counterpart under /pages/, and nginx serves that one
# first for those two URLs — so the copies landing here are the template the
# renderer splices into and the fallback for a Pi that has never published.
# Overwriting them is how the template is updated. The generated pages are
# safe because they are under /pages/, which is excluded above.
#
# The four hand-written project-*.html files are gone from the repo, and there
# is deliberately NO --exclude 'project-*.html' here. The first run after they
# were deleted is what removes the stale copies from the web root, and that is
# the point: nginx tries $uri before /pages/$uri, so a leftover hand-written
# file shadows the generated page for its own URL. An exclusion added "to be
# safe" would freeze those copies in place and keep the shadow forever. The
# generated pages are not at risk, because they live under /pages/, which is
# excluded above.
sudo rsync -a --delete \
  --exclude '/pages/' \
  --exclude '/assets/up/' \
  --exclude 'project-template.html' \
  --exclude 'README.md' \
  --exclude 'CLAUDE.md' --exclude 'claude.md' \
  --exclude 'classic.html' --exclude 'classic.css' \
  --exclude 'deploy/' \
  --exclude 'server/' --exclude 'docs/' \
  --exclude 'docker-compose.yml' \
  --exclude '.claude/' --exclude '.git/' --exclude '.github/' \
  --exclude '*.zip' \
  --exclude 'vault/files/' \
  "$SRC"/ "$WEBROOT"/

sudo chown -R www-data:www-data "$WEBROOT"
sudo find "$WEBROOT" -type d -exec chmod 755 {} \;
sudo find "$WEBROOT" -type f -exec chmod 644 {} \;

# ...and immediately hand the two writable directories back. The blanket
# chown above is recursive and does not care that it just took the API's own
# output away from it; without this, re-running setup-pi.sh silently breaks
# publishing until the next time someone reads a container log.
sudo chown -R 1000:1000 "$WEBROOT/pages" "$WEBROOT/assets/up"

echo "==> Site copied into $WEBROOT"
