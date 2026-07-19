#!/usr/bin/env bash
# refresh-dashboard.sh — regenerate dashboard data files and publish changes.
#
# 1. Runs generate-sites-manifest.py and generate-analytics-snapshot.py.
#    If GA4 fails, the analytics generator writes a fallback snapshot itself;
#    this script logs a warning and continues instead of aborting.
# 2. If sites.json / sites.js / activity.json / analytics.json changed,
#    commits them with a dated message and pushes to origin.
# 3. The Vercel project (site-dashboard) is connected to the GitHub remote,
#    so a push triggers a production deploy. If git push is unavailable and
#    the vercel CLI is installed and authed, falls back to `vercel deploy --prod`.
#
# Idempotent: no data change -> no commit, no push. Exit 0 on success.
set -uo pipefail

cd "$(dirname "$0")"
DATA_FILES=(sites.json sites.js activity.json analytics.json)

log()  { printf '[refresh] %s\n' "$*"; }
warn() { printf '[refresh][WARN] %s\n' "$*" >&2; }
fail() { printf '[refresh][ERROR] %s\n' "$*" >&2; exit 1; }

PY="$(command -v python3 || command -v python)" || fail "no python on PATH"
log "using python: $PY"

# ── 1. Regenerate data ─────────────────────────────────────────────
log "running generate-sites-manifest.py"
"$PY" generate-sites-manifest.py || fail "generate-sites-manifest.py failed"

log "running generate-analytics-snapshot.py"
if ! "$PY" generate-analytics-snapshot.py; then
  # The generator normally writes a fallback snapshot on GA4 errors; a hard
  # failure here means even the fallback did not run. Continue anyway so the
  # previous analytics.json stays in place.
  warn "generate-analytics-snapshot.py failed; keeping previous analytics.json"
fi
if grep -q '"source": "ga4-report-fallback"' analytics.json 2>/dev/null; then
  warn "analytics.json is a fallback snapshot (GA4 unavailable); continuing"
fi

# ── 2. Commit + push if data changed ───────────────────────────────
changed=()
for f in "${DATA_FILES[@]}"; do
  if ! git diff --quiet -- "$f" 2>/dev/null || git ls-files --others --exclude-standard -- "$f" | grep -q .; then
    changed+=("$f")
  fi
done

if [ "${#changed[@]}" -eq 0 ]; then
  log "no changes in data files; nothing to commit. Done."
  exit 0
fi

log "changed files: ${changed[*]}"
git add -- "${DATA_FILES[@]}" || fail "git add failed"
git commit -m "data: daily dashboard refresh $(date +%Y-%m-%d)" || fail "git commit failed"
log "committed: $(git log -1 --format='%h %s')"

if git remote get-url origin >/dev/null 2>&1; then
  log "pushing to origin (Vercel auto-deploys from this GitHub repo)"
  if git push origin HEAD; then
    log "push succeeded; Vercel deploy triggered via git integration."
    exit 0
  fi
  warn "git push failed"
else
  warn "no git remote configured; Vercel git auto-deploy unavailable"
fi

# ── 3. Fallback: Vercel CLI ────────────────────────────────────────
if command -v vercel >/dev/null 2>&1 && vercel whoami >/dev/null 2>&1; then
  log "attempting vercel deploy --prod"
  vercel deploy --prod || fail "vercel deploy failed"
  log "vercel deploy succeeded"
  exit 0
fi

fail "could not publish: git push failed/unavailable and vercel CLI not installed or not authed"
