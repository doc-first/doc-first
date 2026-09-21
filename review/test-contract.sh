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
# A bug report enters as a request like any other — the category is the only difference (docs/BUGS.md).
# The check is here and not only in the unit tests because the category crosses the whole edge: JSON
# body, the pt-BR field name `categoria`, the rename in legacy.js and the size limits on `dados`.
expect "a request categorised as bug → 201" 201 "$(post $REVIEWER '{"tipo":"pedido","pagina":"D02","caixa":"D02.1.3","digital":"x","texto":"the screen does not do what this block says","foto":"the earlier text","dados":{"categoria":"bug"}}')"

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
# ⚠️ Behind an identity proxy there is no user store at all — who exists is the proxy's directory.
# Answering here would invent a second, empty source of truth for who works at the company, and an
# empty list of people is the kind of screen somebody believes.
expect "no user store, no management → 405" 405 "$(curl -s -o /dev/null -w '%{http_code}' -H "X-Dev-Email: $OWNER" $B/api/users)"
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
# ADMIN exists so the guards can be told apart: a MEMBER is refused because they manage nobody,
# an ADMIN is allowed to manage and still refused on the owner. Testing only with a member would
# leave the escalation path — admin resets the owner, signs in as the owner — completely uncovered.
ADMIN=admin@example.org
REVISAO_AMBIENTE=Production REVISAO_OWNER=$OWNER REVISAO_ADMINS=$ADMIN REVISAO_IDENTIDADE=senha REVISAO_BANCO=sqlite \
  REVISAO_PESSOAS=$DATA_DIR/people.db REVISAO_SQLITE=$DATA_DIR/events.db PORT=$PORT \
  REVISAO_SITE="$PWD/examples/ola-mundo" \
  node review/api/server.ts >/tmp/node-password.log 2>&1 & PID=$!
for i in $(seq 40); do curl -s $B/api/saude >/dev/null 2>&1 && break; sleep 0.5; done

# ⚠️ Matches both wordings. The banner said `senha:` until v0.2.1 and says `password:` after, and
# this line is read by scripts that pin an OLDER image on purpose. Changing the banner without this
# turned ten checks red at once, and the product was fine — only the reader was stale.
PASSWORD=$(grep -A2 -E 'PRIMEIRO ACESSO|FIRST ACCESS' /tmp/node-password.log \
  | sed -n -E 's/.*(senha|password): *//p' | head -1)
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

# ----------------------------------------------------------------------------- managing people
# Nothing here deletes anybody. An approval signed by somebody who was removed would be a ✓ with no
# owner, and the trail is half of what this tool is for — so the access goes away and the person
# stays. Everything below is about that one decision holding at the edge.
echo "managing people:"
MEMBER=member@example.org
MCOOKIES=/tmp/cookies-member.txt; rm -f $MCOOKIES
jfield() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const v=process.argv[1].split('.').reduce((o,k)=>(o===undefined||o===null)?o:o[k],JSON.parse(s));console.log(v===undefined||v===null?'':v)})" "$1"; }
as_owner()  { curl -s -b $COOKIES  -H 'Content-Type: application/json' "$@"; }
as_member() { curl -s -b $MCOOKIES -H 'Content-Type: application/json' "$@"; }
code_owner()  { as_owner  -o /dev/null -w '%{http_code}' "$@"; }
code_member() { as_member -o /dev/null -w '%{http_code}' "$@"; }
emails() { as_owner $B/api/users | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).users.map(u=>u.email).join(' ')))"; }
mlogin() { curl -s -c $MCOOKIES -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -d "{\"email\":\"$MEMBER\",\"senha\":\"$1\"}" $B/api/entrar; }
ACOOKIES=/tmp/cookies-admin.txt; rm -f $ACOOKIES
as_admin()   { curl -s -b $ACOOKIES -H 'Content-Type: application/json' "$@"; }
code_admin() { as_admin -o /dev/null -w '%{http_code}' "$@"; }
alogin() { curl -s -c $ACOOKIES -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -d "{\"email\":\"$ADMIN\",\"senha\":\"$1\"}" $B/api/entrar; }

expect "the owner sees the list → 200"  200 "$(code_owner $B/api/users)"
expect "and is in it"                   "$OWNER" "$(as_owner $B/api/users | jfield users.0.email)"
expect "and is able to get in"          true "$(as_owner $B/api/users | jfield users.0.enabled)"

CREATED=$(as_owner -w '\n%{http_code}' -d "{\"email\":\"$MEMBER\",\"name\":\"A Member\"}" $B/api/users)
CREATE_CODE=$(echo "$CREATED" | tail -1); CREATED=$(echo "$CREATED" | head -n -1)
MEMBER_PASSWORD=$(echo "$CREATED" | jfield password)
expect "creating an access → 201"       201 "$CREATE_CODE"
expect "and the password comes back once" 0 "$([ -n "$MEMBER_PASSWORD" ] && echo 0 || echo 1)"
expect "and the new person is enabled"  true "$(echo "$CREATED" | jfield user.enabled)"
expect "and has to change that password" true "$(echo "$CREATED" | jfield user.mustChangePassword)"
# The whole point of "once". A password readable from a listing is a password anyone who can read
# the panel can collect, and one in a log is readable by everybody with access to the collector —
# a far wider audience than the account it opens.
expect "the password is NOT in the listing" 0 "$(as_owner $B/api/users | grep -Fc -e "$MEMBER_PASSWORD")"
expect "nor anywhere in the log"        0 "$(grep -Fc -e "$MEMBER_PASSWORD" /tmp/node-password.log)"
# Ordered in the store, not by the database's own idea of order: three databases with three natural
# orders would hand the same team three different lists.
expect "the list is ordered by e-mail"  "$MEMBER $OWNER" "$(emails)"

expect "the new person signs in → 200"  200 "$(mlogin "$MEMBER_PASSWORD")"
expect "and is nobody special"          outro "$(as_member $B/api/eu | jfield papel)"

# Every management route, against somebody who is neither owner nor admin.
expect "not an admin: the list → 403"   403 "$(code_member $B/api/users)"
expect "not an admin: creating → 403"   403 "$(code_member -d '{"email":"x@example.org","name":"X"}' $B/api/users)"
expect "not an admin: disabling → 403"  403 "$(code_member -d '{"enabled":false}' $B/api/users/$OWNER/enabled)"
expect "not an admin: a new password → 403" 403 "$(code_member -X POST $B/api/users/$OWNER/password)"
# The one route that is about the caller's own row. Fixing the spelling of your own name is not a
# privilege, and making it one would send people to an admin over a typo.
expect "but anybody renames themselves → 200" 200 "$(code_member -d '{"name":"Renamed Themselves"}' $B/api/users/me/name)"
expect "and the listing shows the new name" "Renamed Themselves" "$(as_owner $B/api/users | jfield users.0.name)"
expect "an empty name → 400"            400 "$(code_member -d '{"name":"   "}' $B/api/users/me/name)"

expect "an e-mail that is not one → 400" 400 "$(code_owner -d '{"email":"not an address","name":"X"}' $B/api/users)"
# The bad value goes back in the message: "invalid e-mail" next to a form makes the person guess
# which field, and guess what is wrong with it.
expect "and the message quotes what was typed" 0 "$(as_owner -d '{"email":"not an address","name":"X"}' $B/api/users | grep -q 'not an address'; echo $?)"
expect "a name nobody wrote → 400"      400 "$(code_owner -d '{"email":"other@example.org","name":"  "}' $B/api/users)"
expect "an e-mail already here → 400"   400 "$(code_owner -d "{\"email\":\"$MEMBER\",\"name\":\"Twice\"}" $B/api/users)"
expect "and the message names it"       0 "$(as_owner -d "{\"email\":\"$MEMBER\",\"name\":\"Twice\"}" $B/api/users | grep -q "$MEMBER"; echo $?)"
expect "a new password for nobody → 404" 404 "$(code_owner -X POST $B/api/users/nobody@example.org/password)"
# A half-written escape makes decodeURIComponent throw. Uncaught, that is a 500 with an incident
# id — an answer that says "the service is broken" about a request that was merely malformed.
expect "an address nobody can decode → 404" 404 "$(code_owner -X POST --path-as-is "$B/api/users/%zz/password")"

# ⚠️ Not even the owner may disable the owner. The service refuses to start without exactly one,
# so an owner who cannot sign in is a service where nobody can approve and nobody can hand the role
# over — and the only fix is a restart with a different variable, which is not something the person
# locked out can do from the screen they are looking at.
expect "the owner cannot be disabled → 409" 409 "$(code_owner -d '{"enabled":false}' $B/api/users/$OWNER/enabled)"
expect "and the message says how to hand it over" 0 "$(as_owner -d '{"enabled":false}' $B/api/users/$OWNER/enabled | grep -q 'REVISAO_OWNER'; echo $?)"
expect "and the owner is still in"      200 "$(code_owner $B/api/eu)"

# ⚠️ Nobody resets the OWNER's password but the owner. Without this an admin resets it, reads the
# new password from the response, signs in as the owner — and from then on every ✓ is signed with
# the owner's e-mail. The audit trail becomes a lie, with nothing in the record to show it.
APASS=$(as_owner -d "{\"email\":\"$ADMIN\",\"name\":\"An Admin\"}" $B/api/users | jfield password)
expect "the admin signs in → 200"       200 "$(alogin "$APASS")"
expect "an admin manages people → 200"  200 "$(code_admin $B/api/users)"
expect "an admin cannot reset the owner → 409" 409 "$(code_admin -X POST $B/api/users/$OWNER/password)"
# ⚠️ The twin of the guard above, and the one that was missing. Who the owner IS comes from
# REVISAO_OWNER, not from a column, so the row can legitimately be absent — handing the role over
# leaves it missing, because first-access only runs while the store is empty. In that window an
# admin could CREATE the owner's account, read the generated password from the response, and be
# the owner from then on, never touching the reset route the other guard protects.
expect "an admin cannot create the owner → 409" 409 "$(code_admin -d "{\"email\":\"$OWNER\",\"name\":\"Not Me\"}" $B/api/users)"
expect "and the message says it is provisioned at boot" 0 "$(as_admin -d "{\"email\":\"$OWNER\",\"name\":\"Not Me\"}" $B/api/users | grep -q 'REVISAO_OWNER'; echo $?)"
expect "the owner still can, on themselves" 200 "$(code_owner -X POST $B/api/users/$OWNER/password)"

expect "disabling somebody → 200"       200 "$(code_owner -d '{"enabled":false}' $B/api/users/$MEMBER/enabled)"
# Without this the revocation would land whenever the cookie happened to expire: up to twelve hours
# of somebody just removed still reading, still commenting, still approving.
expect "their open session dies at once → 401" 401 "$(code_member $B/api/eu)"
expect "and the right password no longer gets in → 401" 401 "$(mlogin "$MEMBER_PASSWORD")"
# ⚠️ Reads the member BY E-MAIL, not by position. The list is ordered by e-mail, so `users.0` was
# the member until an admin joined the fixture and took the first slot — a test that silently
# changes what it asserts when somebody adds a row is worse than no test.
expect "but they are still on the list"  false "$(as_owner $B/api/users | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const u=JSON.parse(s).users.find(u=>u.email===process.argv[1]);console.log(u?u.enabled:'not listed')})" "$MEMBER")"
expect "disabling is not deleting"      "$ADMIN $MEMBER $OWNER" "$(emails)"
# A missing field is not "false": read as falsy, a typo in the key would silently revoke somebody.
expect "a body with no enabled → 400"   400 "$(code_owner -d '{}' $B/api/users/$MEMBER/enabled)"

expect "giving the access back → 200"   200 "$(code_owner -d '{"enabled":true}' $B/api/users/$MEMBER/enabled)"
expect "and the same password works again → 200" 200 "$(mlogin "$MEMBER_PASSWORD")"

RESET=$(as_owner -X POST $B/api/users/$MEMBER/password)
NEW_PASSWORD=$(echo "$RESET" | jfield password)
expect "a reset gives back a different password" 0 "$([ -n "$NEW_PASSWORD" ] && [ "$NEW_PASSWORD" != "$MEMBER_PASSWORD" ]; echo $?)"
# Somebody OTHER than the owner of the account has seen this one — whoever ran the reset, and
# whatever channel carried it over. The window has to be one login long.
expect "and it demands a change"        true "$(echo "$RESET" | jfield user.mustChangePassword)"
expect "the old password stops working → 401" 401 "$(mlogin "$MEMBER_PASSWORD")"
expect "the new one gets in → 200"      200 "$(mlogin "$NEW_PASSWORD")"
expect "and it is not in the listing"   0 "$(as_owner $B/api/users | grep -Fc -e "$NEW_PASSWORD")"
expect "nor in the log"                 0 "$(grep -Fc -e "$NEW_PASSWORD" /tmp/node-password.log)"
rm -f $MCOOKIES

# ------------------------------------------------------------------ handing the owner role over
# ⚠️ THE window, and the one the guard above exists for. Who the owner IS comes from
# REVISAO_OWNER, not from a column, and first access only provisions a row while the store is
# EMPTY. So restarting with a NEW owner address over a store that already has people leaves the
# owner's row missing — and an admin who was already there could create it, read the generated
# password out of the response, and be the owner from then on.
#
# The check above the reset route never sees this path: the attacker never resets anything.
HANDOVER=newowner@example.org
kill $PID 2>/dev/null; wait $PID 2>/dev/null
REVISAO_AMBIENTE=Production REVISAO_OWNER=$HANDOVER REVISAO_ADMINS=$ADMIN REVISAO_IDENTIDADE=senha \
  REVISAO_BANCO=sqlite REVISAO_PESSOAS=$DATA_DIR/people.db REVISAO_SQLITE=$DATA_DIR/events.db \
  PORT=$PORT REVISAO_SITE="$PWD/examples/ola-mundo" \
  node review/api/server.ts >/tmp/node-handover.log 2>&1 & PID=$!
for i in $(seq 40); do curl -s $B/api/saude >/dev/null 2>&1 && break; sleep 0.5; done

expect "the new owner has no account yet" 0 "$(as_admin $B/api/users | grep -Fvc "$HANDOVER" >/dev/null; as_admin $B/api/users | grep -Fq "$HANDOVER"; [ $? -ne 0 ]; echo $?)"
expect "and no first-access was printed" 0 "$(grep -c 'FIRST ACCESS' /tmp/node-handover.log)"
expect "an admin still cannot create it → 409" 409 "$(code_admin -d "{\"email\":\"$HANDOVER\",\"name\":\"Taking Over\"}" $B/api/users)"
expect "so nobody signed in as the new owner" 401 "$(curl -s -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -d "{\"email\":\"$HANDOVER\",\"senha\":\"anything-at-all\"}" $B/api/entrar)"
kill $PID 2>/dev/null; wait $PID 2>/dev/null

REVISAO_AMBIENTE=Production REVISAO_OWNER=$OWNER REVISAO_ADMINS=$ADMIN REVISAO_IDENTIDADE=senha \
  REVISAO_BANCO=sqlite REVISAO_PESSOAS=$DATA_DIR/people.db REVISAO_SQLITE=$DATA_DIR/events.db \
  PORT=$PORT REVISAO_SITE="$PWD/examples/ola-mundo" \
  node review/api/server.ts >>/tmp/node-password.log 2>&1 & PID=$!
for i in $(seq 40); do curl -s $B/api/saude >/dev/null 2>&1 && break; sleep 0.5; done

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
