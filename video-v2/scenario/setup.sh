#!/usr/bin/env bash
# Creates the fictional Riverton workspace the film is based on.
#   bash setup.sh <empty-dir>
# Then start the server in that directory (`decisionloop serve --web`) and run:
#   node run.mjs <dir> http://127.0.0.1:4520 "$(cat <dir>/hydrology.key)" "$(cat <dir>/forum.key)"
set -euo pipefail
DIR="$1"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
DL="node $REPO/bin/decisionloop.mjs"
mkdir -p "$DIR" && cd "$DIR"
$DL init --name "Riverton City (fictional)" --profile planning --port 4520
key() { $DL key create --name "$1" --source "$2" --json | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).key"; }
key national-hydrology hydrology > hydrology.key
key residents-forum forum > forum.key
echo "Workspace ready in $DIR"
