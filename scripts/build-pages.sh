#!/usr/bin/env bash
# Builds a static copy of the app for GitHub Pages, in local mode (no
# database, no sign-in, data saved in the browser). The output is in out/.
#
# A static site has no server, so the server-only parts (middleware, API
# routes and the sign-out route) are set aside during the build and put back
# afterwards. The normal `npm run build` is unchanged.
#
# Usage: BASE_PATH=/t-rack-cg scripts/build-pages.sh
set -euo pipefail
cd "$(dirname "$0")/.."

SERVER_ONLY=(src/middleware.ts src/app/api src/app/auth)
STASH=".pages-stash"

restore() {
  for p in "${SERVER_ONLY[@]}"; do
    if [ -e "$STASH/$p" ]; then
      mkdir -p "$(dirname "$p")"
      mv "$STASH/$p" "$p"
    fi
  done
  rm -rf "$STASH"
}
trap restore EXIT

for p in "${SERVER_ONLY[@]}"; do
  if [ -e "$p" ]; then
    mkdir -p "$STASH/$(dirname "$p")"
    mv "$p" "$STASH/$p"
  fi
done

# No keys or AWS values reach this build, so it always runs in local mode.
env -u NEXT_PUBLIC_SUPABASE_URL -u NEXT_PUBLIC_SUPABASE_ANON_KEY \
  -u NEXT_PUBLIC_DATA_BACKEND -u DYNAMODB_TABLE \
  -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY -u AWS_REGION \
  NEXT_PUBLIC_LOCAL_MODE=true \
  NEXT_PUBLIC_STATIC_PREVIEW=true \
  NEXT_PUBLIC_BASE_PATH="${BASE_PATH:-}" \
  npx next build

# Tells GitHub Pages to serve folders that start with "_" (like _next/).
touch out/.nojekyll
