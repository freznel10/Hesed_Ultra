#!/bin/bash
# Double-click in Finder to open Hesed Ultra in your browser.
# If it is already running (for example because Claude started it), this just opens the page.
cd "$(dirname "$0")"
if curl -sf http://localhost:5173/api/health >/dev/null 2>&1; then
  open http://localhost:5173
  exit 0
fi
(for i in $(seq 1 30); do sleep 1; curl -sf http://localhost:5173/api/health >/dev/null 2>&1 && open http://localhost:5173 && break; done) &
echo "Hesed Ultra is running. Close this window to stop it."
npm run dev
