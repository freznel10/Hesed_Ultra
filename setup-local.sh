#!/usr/bin/env bash
# One-time setup on your Mac. Run it from the folder that should hold the project:
#   cd "/Volumes/T7 Shield/Projects/Hesed_Ultra" && bash <(curl -fsSL https://raw.githubusercontent.com/freznel10/Hesed_Ultra/claude/keen-ride-0slm77/setup-local.sh)
# Your existing files in the folder are left untouched.
set -euo pipefail
BRANCH="claude/keen-ride-0slm77"

command -v git >/dev/null || { echo "Install git first (xcode-select --install)."; exit 1; }
command -v node >/dev/null || { echo "Install Node.js 20 or newer first (https://nodejs.org or: brew install node)."; exit 1; }

if [ ! -d .git ]; then
  git init -q
  git remote add origin https://github.com/freznel10/Hesed_Ultra.git
fi
git fetch -q origin "$BRANCH"
if git rev-parse -q --verify HEAD >/dev/null; then
  git merge -q --ff-only "origin/$BRANCH"
else
  git checkout -q -b main "origin/$BRANCH"
fi

npm install
npm run db:seed
echo
echo "Done. Start the app with:  npm run dev   then open http://localhost:5173"
