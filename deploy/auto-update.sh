#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# kira1q.dev — keep the Pi up to date on its own.
#
#     ~/Portfolio/deploy/auto-update.sh --install    once: run every 10 minutes
#     ~/Portfolio/deploy/auto-update.sh --uninstall  stop it
#     ~/Portfolio/deploy/auto-update.sh              one check, what cron runs
#
# Each run does nothing unless something is new:
#   - a new commit on main   -> update.sh --static (site files, nginx)
#   - a new API image on GHCR -> update.sh --api, then re-render the pages
#
# The two are checked separately on purpose. CI needs a few minutes to build
# the image after a push, so the commit usually arrives one run before its
# image does; a later run picks the image up on its own.
#
# Needs sudo without a password prompt (cron cannot type one). --install
# checks that. The log is ~/auto-update.log, trimmed to its last 2000 lines.
# ---------------------------------------------------------------------------
set -uo pipefail

REPO="${REPO:-$HOME/Portfolio}"
BRANCH="${BRANCH:-main}"
LOG="$HOME/auto-update.log"
SELF="$REPO/deploy/auto-update.sh"
CRON_LINE="*/10 * * * * $SELF >> $LOG 2>&1"

case "${1:-}" in
  --install)
    if ! sudo -n true 2>/dev/null; then
      echo "!! sudo asks for a password, so cron could not run the update." >&2
      echo "   Allow it for this user, then run --install again:" >&2
      echo "       echo \"$USER ALL=(ALL) NOPASSWD:ALL\" | sudo tee /etc/sudoers.d/90-$USER-nopasswd" >&2
      exit 1
    fi
    ( crontab -l 2>/dev/null | grep -vF "$SELF"; echo "$CRON_LINE" ) | crontab -
    echo "Installed. Checks every 10 minutes; log: $LOG"
    exit 0
    ;;
  --uninstall)
    crontab -l 2>/dev/null | grep -vF "$SELF" | crontab -
    echo "Removed."
    exit 0
    ;;
esac

# One run at a time: a slow image pull must not overlap the next tick.
exec 9>/tmp/kira1q-auto-update.lock
flock -n 9 || exit 0

stamp() { printf '[%s] %s\n' "$(date '+%F %T')" "$1"; }

# ---- new commit? -----------------------------------------------------------
git -C "$REPO" fetch --quiet origin "$BRANCH" || { stamp "fetch failed"; exit 1; }
if [ "$(git -C "$REPO" rev-parse HEAD)" != "$(git -C "$REPO" rev-parse "origin/$BRANCH")" ]; then
  stamp "new commit $(git -C "$REPO" rev-parse --short "origin/$BRANCH"), updating the site"
  "$REPO/deploy/update.sh" --static || stamp "site update FAILED"
fi

# ---- new image? ------------------------------------------------------------
cd "$REPO" || exit 1
sudo docker compose pull --quiet api >/dev/null 2>&1 || { stamp "image pull failed"; exit 1; }
running=$(sudo docker inspect -f '{{.Image}}' "$(sudo docker compose ps -q api)" 2>/dev/null || true)
latest=$(sudo docker image inspect -f '{{.Id}}' "$(sudo docker compose config --images api)" 2>/dev/null || true)

if [ -n "$latest" ] && [ "$running" != "$latest" ]; then
  stamp "new API image, restarting and re-rendering the pages"
  if "$REPO/deploy/update.sh" --api; then
    sudo docker compose exec -T api node dist/cli.js render && stamp "pages re-rendered"
  else
    stamp "API update FAILED"
  fi
fi

# Keep the log from growing forever.
if [ -f "$LOG" ] && [ "$(wc -l < "$LOG")" -gt 2000 ]; then
  tail -n 2000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi
