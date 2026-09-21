#!/usr/bin/env bash
# Same HTTP contract that testar-local.sh demands from the API — now against the Node server.
# Usage: bash review/test-contract.sh
set -uo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd); cd "$ROOT/.."
PORT=${PORT:-18095}; B=http://127.0.0.1:$PORT; FAILURES=0
export OWNER=owner@example.org; export REVIEWER=reviewer@example.org

expect() { if [ "$2" = "$3" ]; then echo "  ok   $1"; else echo "  FAIL $1 — expected $2, got $3"; FAILURES=$((FAILURES+1)); fi; }

# A port already in use is the most treacherous failure I've seen here: the new server dies with
# EADDRINUSE, the old one keeps answering, and the whole suite ends up testing the previous code —
# once this nearly made me undo a fix that was actually correct. Better not to run than to run while
# lying.
if curl -s -o /dev/null --max-time 2 $B/api/saude; then
  echo "port $PORT is already in use — the test would run against ANOTHER server."
  ss -ltnp 2>/dev/null | grep ":$PORT " || true
  echo "  kill the process (or run with PORT=another) and try again."
  exit 1
fi
# A server left behind by an interrupted run also breaks the next round.
PID=
trap 'kill $PID 2>/dev/null' EXIT INT TERM
post()  { curl -s -o /dev/null -w '%{http_code}' -H "X-Dev-Email: $1" -H 'Content-Type: application/json' -d "$2" $B/api/eventos; }
body() { curl -s -H "X-Dev-Email: $1" -H 'Content-Type: application/json' -d "$2" $B/api/eventos; }
new_request()  { body "$1" "$2" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).id))"; }
state()   { post "$1" "{\"tipo\":\"pedido_estado\",\"pagina\":\"D02\",\"texto\":\"$4\",\"dados\":{\"pedido\":\"$2\",\"estado\":\"$3\"${5:-}}}"; }

# REVISAO_DEV_EMAIL empty on purpose: with `desenvolvimento.comoQuem` in doc-first.json, a request
# with no header would end up identified — which is the right behavior for opening the browser, but
# it would hide the test that proves that with NO identity at all the response is 401.
REVISAO_MODO=local REVISAO_AMBIENTE=Development REVISAO_OWNER=$OWNER REVISAO_DEV_EMAIL= PORT=$PORT \
  REVISAO_SITE="$PWD/examples/ola-mundo" \
  node review/api/server.ts >/tmp/node-tests.log 2>&1 & PID=$!
for i in $(seq 40); do curl -s $B/api/saude >/dev/null 2>&1 && break; sleep 0.5; done

echo "identity and roles:"
expect "no identity → 401"             401 "$(curl -s -o /dev/null -w '%{http_code}' $B/api/eventos)"
expect "owner is owner"                owner "$(curl -s -H "X-Dev-Email: $OWNER" $B/api/eu | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).papel))")"
expect "reviewer is other"             outro "$(curl -s -H "X-Dev-Email: $REVIEWER" $B/api/eu | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).papel))")"
expect "capability instead of role"    true "$(curl -s -H "X-Dev-Email: $OWNER" $B/api/eu | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).podeAprovar))")"

echo "approval:"
expect "reviewer does NOT approve → 403" 403 "$(post $REVIEWER '{"tipo":"aprovacao","pagina":"D01","caixa":"D01.1.4","digital":"abc123"}')"
expect "owner approves → 201"          201 "$(post $OWNER '{"tipo":"aprovacao","pagina":"D01","caixa":"D01.1.4","digital":"abc123"}')"
expect "approval without digital → 400" 400 "$(post $OWNER '{"tipo":"aprovacao","pagina":"D01","caixa":"D01.1.4"}')"
expect "unknown type → 400"            400 "$(post $OWNER '{"tipo":"delete","pagina":"D01"}')"

echo "limits:"
LARGE=$(node -e "console.log('x'.repeat(500))")
expect "giant caixa → 400"             400 "$(post $OWNER "{\"tipo\":\"aprovacao\",\"pagina\":\"D01\",\"caixa\":\"$LARGE\",\"digital\":\"a\"}")"
expect "invalid page → 400"            400 "$(post $OWNER '{"tipo":"comentario","pagina":"../etc","texto":"hi"}')"
expect "UC-01 is a valid page → 201"   201 "$(post $OWNER '{"tipo":"comentario","pagina":"UC-01","texto":"hi"}')"
# The error has to say WHICH field overflowed, not just "field too big": with seven limits, a
# generic message forces whoever called it to guess. Look for `snapshot`, the engine's word.
# ⚠️ The contract still receives the field as `foto` (pt-BR) and the error already answers with
# `snapshot` (English) — the caller sees a name it never sent. This closes in step 5, when the
# contract turns English.
expect "error says WHICH field"        0 "$(body $OWNER "{\"tipo\":\"comentario\",\"pagina\":\"D01\",\"texto\":\"hi\",\"foto\":\"$(node -e "console.log('y'.repeat(20001))")\"}" | grep -qi snapshot; echo $?)"

echo "request cycle:"
P=$(new_request $REVIEWER '{"tipo":"pedido","pagina":"D02","caixa":"D02.1.1","digital":"x","texto":"change term","foto":"the earlier text"}')
expect "reviewer can't triage → 403"   403 "$(state $REVIEWER $P aprovado 'x')"
expect "reject without a reason → 400" 400 "$(state $OWNER $P recusado '')"
expect "owner rejects → 201"           201 "$(state $OWNER $P recusado 'does not say where')"
expect "rejected → approved → 201"     201 "$(state $OWNER $P aprovado 'reviewed')"
expect "approved doesn't go back → 409" 409 "$(state $OWNER $P recusado 'changed my mind')"
expect "applied without a commit → 400" 400 "$(state agent@test $P aplicado 'done')"
expect "applied with a commit → 201"   201 "$(state agent@test $P aplicado 'done' ',"commit":"abc1234"')"

echo "a request from someone who can approve is born approved:"
P2=$(new_request $OWNER '{"tipo":"pedido","pagina":"D02","caixa":"D02.2.1","digital":"x","texto":"my request"}')
expect "already born approved → 409"   409 "$(state $OWNER $P2 aprovado 'redundant')"
expect "the agent applies directly → 201" 201 "$(state agent@test $P2 analise 'looking')"

echo "situation calculated by the server:"
expect "owner's request: approved"     analise "$(curl -s -H "X-Dev-Email: $OWNER" "$B/api/eventos?pagina=D02" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const e=JSON.parse(s).find(x=>x.tipo==='pedido'&&x.autor===process.env.OWNER);console.log(e.situacao.estado)})")"
expect "empty triage when approved"    0 "$(curl -s -H "X-Dev-Email: $OWNER" "$B/api/eventos?pagina=D02" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const e=JSON.parse(s).find(x=>x.tipo==='pedido'&&x.autor===process.env.OWNER);console.log(e.situacao.triagem.length)})")"

echo "contract and site:"
ID=$(new_request $OWNER '{"tipo":"comentario","pagina":"D01","texto":"find by id"}')
expect "GET /api/eventos/{id} → 200"   200 "$(curl -s -o /dev/null -w '%{http_code}' -H "X-Dev-Email: $OWNER" $B/api/eventos/$ID)"
expect "nonexistent id → 404"          404 "$(curl -s -o /dev/null -w '%{http_code}' -H "X-Dev-Email: $OWNER" $B/api/eventos/doesnotexist)"
expect "static site serves"            200 "$(curl -s -o /dev/null -w '%{http_code}' $B/paginas/A01.html)"
expect "root redirects"                302 "$(curl -s -o /dev/null -w '%{http_code}' $B/)"
# Node's `new URL()` already normalizes `../`, so this vector arrives as /etc/passwd and returns 404
# (it doesn't leak, but for a different reason). What the prefix guard actually catches is the
# ENCODED `..`, which survives parsing and only becomes `..` at decodeURIComponent.
expect "encoded traversal → 403"       403 "$(curl -s -o /dev/null -w '%{http_code}' --path-as-is "$B/%2e%2e%2f%2e%2e%2fetc/passwd")"
expect "raw traversal doesn't leak"    404 "$(curl -s -o /dev/null -w '%{http_code}' --path-as-is $B/front/../../../etc/passwd)"
kill $PID 2>/dev/null; wait $PID 2>/dev/null

echo "local mode does NOT turn on outside development:"
REVISAO_MODO=local REVISAO_AMBIENTE=Production REVISAO_OWNER=$OWNER REVISAO_AUDIENCIA=/projects/0/x PORT=$PORT \
  REVISAO_SITE="$PWD/examples/ola-mundo" \
  node review/api/server.ts >/tmp/node-prod.log 2>&1 & PID=$!
for i in $(seq 40); do curl -s $B/api/saude >/dev/null 2>&1 && break; sleep 0.5; done
expect "X-Dev-Email ignored → 401"     401 "$(curl -s -o /dev/null -w '%{http_code}' -H "X-Dev-Email: $OWNER" $B/api/eu)"
expect "and warns in the log"          0 "$(grep -qi 'IGNORADO' /tmp/node-prod.log; echo $?)"
expect "forged email → 401"            401 "$(curl -s -o /dev/null -w '%{http_code}' -H 'x-goog-authenticated-user-email: accounts.google.com:x@y' $B/api/eu)"
expect "forged JWT → 401"              401 "$(curl -s -o /dev/null -w '%{http_code}' -H 'x-goog-iap-jwt-assertion: eyJhbGciOiJFUzI1NiJ9.eyJlbWFpbCI6ImhhY2tlckB4In0.abc' $B/api/eu)"
kill $PID 2>/dev/null; wait $PID 2>/dev/null

echo "comes up with no cloud at all (username, password and a single file):"
# This is the path for whoever downloads the image: no Google variable, no project, no IAP.
DATA_DIR=$(mktemp -d); COOKIES=/tmp/cookies-contract.txt; rm -f $COOKIES
REVISAO_AMBIENTE=Production REVISAO_OWNER=$OWNER REVISAO_IDENTIDADE=senha REVISAO_BANCO=sqlite \
  REVISAO_PESSOAS=$DATA_DIR/people.db REVISAO_SQLITE=$DATA_DIR/events.db PORT=$PORT \
  REVISAO_SITE="$PWD/examples/ola-mundo" \
  node review/api/server.ts >/tmp/node-password.log 2>&1 & PID=$!
for i in $(seq 40); do curl -s $B/api/saude >/dev/null 2>&1 && break; sleep 0.5; done

PASSWORD=$(grep -A2 'PRIMEIRO ACESSO' /tmp/node-password.log | sed -n 's/.*senha: *//p')
expect "the first password is said once" 0 "$([ -n "$PASSWORD" ] && echo 0 || echo 1)"
expect "and it isn't 'admin'"          1 "$(echo "$PASSWORD" | grep -qx 'admin'; echo $?)"
login() { curl -s -c $COOKIES -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -d "{\"email\":\"$OWNER\",\"senha\":\"$1\"}" $B/api/entrar; }

expect "no session → 401"              401 "$(curl -s -o /dev/null -w '%{http_code}' $B/api/eu)"
# There is no IAP at the edge here: if the static site doesn't require a session, the whole
# documentation is left open to anyone who reaches the port — and whoever brought the image up
# believing they had configured login never suspects a thing.
expect "the docs do NOT open without a session" 302 "$(curl -s -o /dev/null -w '%{http_code}' $B/paginas/A01.html)"
expect "and sends it to the login screen" 0 "$(curl -s -D- -o /dev/null $B/paginas/A01.html | grep -qi 'location: /entrar'; echo $?)"
expect "keeping track of where it was headed" 0 "$(curl -s -D- -o /dev/null $B/paginas/A01.html | grep -q 'destino=%2Fpaginas%2FA01'; echo $?)"
expect "the login screen opens → 200"  200 "$(curl -s -o /dev/null -w '%{http_code}' $B/entrar)"
# The login screen is the clickjacking target: an invisible "Approve" laid over a real one, and an
# approval here is a lock in a repository. It does not go through json() nor through the static
# file path, so it was the one page missing the header — checked here so it cannot happen twice.
expect "and it refuses to be framed"     1 "$(curl -s -D- -o /dev/null $B/entrar | grep -ci "frame-ancestors 'none'")"
expect "and it says nosniff"             1 "$(curl -s -D- -o /dev/null $B/entrar | grep -ci 'x-content-type-options: nosniff')"
expect "and it doesn't ask for anything external" 1 "$(curl -s $B/entrar | grep -qE '<link|src=\"/front'; echo $?)"
expect "X-Dev-Email doesn't count here → 401" 401 "$(curl -s -o /dev/null -w '%{http_code}' -H "X-Dev-Email: $OWNER" $B/api/eu)"
expect "wrong password → 401"          401 "$(login 'not-the-password')"
expect "correct password → 200"        200 "$(login "$PASSWORD")"
expect "and the session identifies the owner" owner "$(curl -s -b $COOKIES $B/api/eu | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).papel))")"
expect "and the owner truly approves"  201 "$(curl -s -b $COOKIES -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -d '{"tipo":"aprovacao","pagina":"D01","caixa":"D01.1.4","digital":"abc123"}' $B/api/eventos)"
expect "the first-access password requires a change" true "$(curl -s -b $COOKIES $B/api/eu | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).precisaTrocarSenha))")"
expect "now the docs open → 200"       200 "$(curl -s -b $COOKIES -o /dev/null -w '%{http_code}' $B/paginas/A01.html)"
# The HTML must NOT be cached: otherwise a text fix never reaches someone who already opened the
# page — and, worse, the digital the browser computes ends up matching text that has already
# changed on disk.
expect "HTML is not cached"            0 "$(curl -s -b $COOKIES -D- -o /dev/null $B/paginas/A01.html | grep -qi 'cache-control: no-cache'; echo $?)"
expect "and /entrar no longer has anything to do" 302 "$(curl -s -b $COOKIES -o /dev/null -w '%{http_code}' $B/entrar)"
expect "logout → 200"                  200 "$(curl -s -b $COOKIES -o /dev/null -w '%{http_code}' -X POST $B/api/sair)"
expect "and after logging out → 401"   401 "$(curl -s -b $COOKIES -o /dev/null -w '%{http_code}' $B/api/eu)"
kill $PID 2>/dev/null; wait $PID 2>/dev/null

# The recorded event has to survive shutdown — that's the difference between sqlite and memory.
expect "the event is still there after shutdown" 1 "$(node -e "
  const {DatabaseSync}=require('node:sqlite');
  console.log(new DatabaseSync('$DATA_DIR/events.db').prepare('SELECT COUNT(*) c FROM events').get().c)")"
rm -rf $DATA_DIR $COOKIES

echo "with no configuration, it won't come up:"
# Outside a project (no doc-first.json) and no variable: there's nowhere to pull the owner from.
mkdir -p /tmp/doc-first-empty
REVISAO_SITE=/tmp/doc-first-empty PORT=$PORT timeout 15 node review/api/server.ts >/tmp/node-no-config.log 2>&1
expect "no owner anywhere → exits 1"   1 "$?"
expect "and says what's missing"       0 "$(grep -qi 'REVISAO_OWNER' /tmp/node-no-config.log; echo $?)"

echo; [ $FAILURES -eq 0 ] && echo "all good" || { echo "$FAILURES failure(s)"; exit 1; }
