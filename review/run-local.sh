#!/usr/bin/env bash
# Brings up the site + the API on your machine, just like it runs in the cloud, with TEST data in memory.
# Nothing goes to Firestore; when you stop it (Ctrl+C), the test events disappear.
# The pages come straight from the repository: edit, reload the browser.
# Usage: bash review/run-local.sh              → http://localhost:8095
#        ACTING_AS=reviewer@example.org bash review/run-local.sh   → simulates another person
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
# Who approves and who you pretend to be come from the project's doc-first.json — the engine has no fixed email.
read_config() { node -e "
const {readConfig}=await import('./review/core/config.js');
const fs=await import('node:fs');
const c=readConfig(process.cwd(),{readFile:p=>fs.readFileSync(p,'utf8')},process.env);
console.log(c[process.argv[1]] ?? '');" --input-type=module "$1" 2>/dev/null; }
OWNER=${REVISAO_OWNER:-$(read_config owner)}
ACTING_AS=${ACTING_AS:-${REVISAO_DEV_EMAIL:-$(read_config actAs)}}
PORT=${PORT:-$(read_config port)}; PORT=${PORT:-8095}
[ -n "$OWNER" ] || { echo "✗ missing the owner: put it in doc-first.json or in REVISAO_OWNER."; exit 1; }

# If the port is already in use, the OLD process keeps answering — and you end up testing the
# previous binary without knowing it. It happened twice on 2026-09-17, and one of those times nearly
# made me undo a fix that was actually correct. Better not to come up than to come up lying.
if ss -ltn 2>/dev/null | grep -q ":$PORT "; then
  PID=$(ss -ltnp 2>/dev/null | grep ":$PORT " | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2)
  echo "✗ port $PORT is already in use (pid ${PID:-?})."
  echo "  What answers there is the OLD process, not the code you just changed."
  echo "  Stop it with:  kill ${PID:-<pid>}      or use another one:  PORT=8096 bash review/run-local.sh"
  exit 1
fi

[ -d node_modules ] || { echo "installing dependencies..."; npm install --silent; }
# ⚠️ There used to be a `( cd front && python3 gerar_index.py )` here. `front/` left with the
# separation — it belonged to the project this engine grew in, not to the engine. With `set -e`,
# that line made this script exit 1 before starting anything at all: the documented way to run
# Doc First locally had been dead, silently, and no test noticed because no test runs this file.

echo "Doc First local → http://localhost:$PORT   (you are acting as: $ACTING_AS · test data, disappears when you stop)"
exec env REVISAO_MODO=local REVISAO_AMBIENTE=Development REVISAO_OWNER="$OWNER" \
  REVISAO_DEV_EMAIL="$ACTING_AS" REVISAO_SITE="$ROOT" PORT="$PORT" \
  node review/api/server.ts
