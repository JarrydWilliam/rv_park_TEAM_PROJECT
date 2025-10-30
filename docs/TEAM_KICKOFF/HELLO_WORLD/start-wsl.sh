#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# install deps every time (safe + quick if unchanged)
npm install

PORT="${PORT:-3001}"
echo "Starting Hello World server on http://localhost:${PORT}"
exec npm start
