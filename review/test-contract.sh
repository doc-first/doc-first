#!/usr/bin/env bash
# Mesmo contrato HTTP que o testar-local.sh cobra da API — agora contra o servidor Node.
# Uso: bash review/test-contract.sh
set -uo pipefail
RAIZ=$(cd "$(dirname "$0")" && pwd); cd "$RAIZ/.."
PORTA=${PORTA:-18095}; B=http://127.0.0.1:$PORTA; FALHAS=0
export DONO=dono@exemplo.org; export KAM=revisora@exemplo.org

espera() { if [ "$2" = "$3" ]; then echo "  ok   $1"; else echo "  FALHA $1 — esperado $2, veio $3"; FALHAS=$((FALHAS+1)); fi; }

# Porta ocupada é a falha mais traiçoeira que já vi aqui: o servidor novo morre com EADDRINUSE, o
# velho continua respondendo, e a suíte inteira testa o código anterior — uma vez isso quase me fez
# desfazer uma correção que estava certa. Melhor não rodar do que rodar mentindo.
if curl -s -o /dev/null --max-time 2 $B/api/saude; then
  echo "porta $PORTA já está ocupada — o teste rodaria contra OUTRO servidor."
  ss -ltnp 2>/dev/null | grep ":$PORTA " || true
  echo "  mate o processo (ou rode com PORTA=outra) e tente de novo."
  exit 1
fi
# Um servidor deixado para trás por uma execução interrompida também derruba a rodada seguinte.
PID=
trap 'kill $PID 2>/dev/null' EXIT INT TERM
post()  { curl -s -o /dev/null -w '%{http_code}' -H "X-Dev-Email: $1" -H 'Content-Type: application/json' -d "$2" $B/api/eventos; }
corpo() { curl -s -H "X-Dev-Email: $1" -H 'Content-Type: application/json' -d "$2" $B/api/eventos; }
novo()  { corpo "$1" "$2" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).id))"; }
est()   { post "$1" "{\"tipo\":\"pedido_estado\",\"pagina\":\"D02\",\"texto\":\"$4\",\"dados\":{\"pedido\":\"$2\",\"estado\":\"$3\"${5:-}}}"; }

# REVISAO_DEV_EMAIL vazio de propósito: com `desenvolvimento.comoQuem` no doc-first.json, uma
# requisição sem cabeçalho passaria a ser identificada — que é o certo para abrir o navegador, mas
# esconderia o teste de que sem identidade NENHUMA a resposta é 401.
REVISAO_MODO=local REVISAO_AMBIENTE=Development REVISAO_OWNER=$DONO REVISAO_DEV_EMAIL= PORT=$PORTA \
  REVISAO_SITE="$PWD/examples/ola-mundo" \
  node review/api/server.ts >/tmp/node-testes.log 2>&1 & PID=$!
for i in $(seq 40); do curl -s $B/api/saude >/dev/null 2>&1 && break; sleep 0.5; done

echo "identidade e papéis:"
espera "sem identidade → 401"          401 "$(curl -s -o /dev/null -w '%{http_code}' $B/api/eventos)"
espera "owner é owner"                 owner "$(curl -s -H "X-Dev-Email: $DONO" $B/api/eu | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).papel))")"
espera "revisora é outro"              outro "$(curl -s -H "X-Dev-Email: $KAM" $B/api/eu | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).papel))")"
espera "capacidade em vez de papel"    true "$(curl -s -H "X-Dev-Email: $DONO" $B/api/eu | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).podeAprovar))")"

echo "aprovação:"
espera "revisora NÃO aprova → 403"     403 "$(post $KAM '{"tipo":"aprovacao","pagina":"D01","caixa":"D01.1.4","digital":"abc123"}')"
espera "owner aprova → 201"            201 "$(post $DONO '{"tipo":"aprovacao","pagina":"D01","caixa":"D01.1.4","digital":"abc123"}')"
espera "aprovação sem digital → 400"   400 "$(post $DONO '{"tipo":"aprovacao","pagina":"D01","caixa":"D01.1.4"}')"
espera "tipo desconhecido → 400"       400 "$(post $DONO '{"tipo":"apagar","pagina":"D01"}')"

echo "limites:"
GRANDE=$(node -e "console.log('x'.repeat(500))")
espera "caixa gigante → 400"           400 "$(post $DONO "{\"tipo\":\"aprovacao\",\"pagina\":\"D01\",\"caixa\":\"$GRANDE\",\"digital\":\"a\"}")"
espera "página inválida → 400"         400 "$(post $DONO '{"tipo":"comentario","pagina":"../etc","texto":"oi"}')"
espera "UC-01 é página válida → 201"   201 "$(post $DONO '{"tipo":"comentario","pagina":"UC-01","texto":"oi"}')"
espera "erro diz QUAL campo"           0 "$(corpo $DONO "{\"tipo\":\"comentario\",\"pagina\":\"D01\",\"texto\":\"oi\",\"foto\":\"$(node -e "console.log('y'.repeat(20001))")\"}" | grep -qi foto; echo $?)"

echo "ciclo do pedido:"
P=$(novo $KAM '{"tipo":"pedido","pagina":"D02","caixa":"D02.1.1","digital":"x","texto":"trocar termo","foto":"texto de então"}')
espera "revisora não tria → 403"       403 "$(est $KAM $P aprovado 'x')"
espera "recusar sem motivo → 400"      400 "$(est $DONO $P recusado '')"
espera "owner recusa → 201"            201 "$(est $DONO $P recusado 'falta dizer onde')"
espera "recusado → aprovado → 201"     201 "$(est $DONO $P aprovado 'revi')"
espera "aprovado não volta → 409"      409 "$(est $DONO $P recusado 'mudei de ideia')"
espera "aplicado sem commit → 400"     400 "$(est agente@teste $P aplicado 'feito')"
espera "aplicado com commit → 201"     201 "$(est agente@teste $P aplicado 'feito' ',"commit":"abc1234"')"

echo "pedido de quem pode aprovar nasce aprovado:"
P2=$(novo $DONO '{"tipo":"pedido","pagina":"D02","caixa":"D02.2.1","digital":"x","texto":"meu pedido"}')
espera "já nasce aprovado → 409"       409 "$(est $DONO $P2 aprovado 'redundante')"
espera "o agente aplica direto → 201"  201 "$(est agente@teste $P2 analise 'vendo')"

echo "situação calculada pelo servidor:"
espera "pedido do owner: aprovado"     analise "$(curl -s -H "X-Dev-Email: $DONO" "$B/api/eventos?pagina=D02" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const e=JSON.parse(s).find(x=>x.tipo==='pedido'&&x.autor===process.env.DONO);console.log(e.situacao.estado)})")"
espera "triagem vazia em aprovado"     0 "$(curl -s -H "X-Dev-Email: $DONO" "$B/api/eventos?pagina=D02" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const e=JSON.parse(s).find(x=>x.tipo==='pedido'&&x.autor===process.env.DONO);console.log(e.situacao.triagem.length)})")"

echo "contrato e site:"
ID=$(novo $DONO '{"tipo":"comentario","pagina":"D01","texto":"achar por id"}')
espera "GET /api/eventos/{id} → 200"   200 "$(curl -s -o /dev/null -w '%{http_code}' -H "X-Dev-Email: $DONO" $B/api/eventos/$ID)"
espera "id inexistente → 404"          404 "$(curl -s -o /dev/null -w '%{http_code}' -H "X-Dev-Email: $DONO" $B/api/eventos/naoexiste)"
espera "site estático serve"           200 "$(curl -s -o /dev/null -w '%{http_code}' $B/paginas/A01.html)"
espera "raiz redireciona"              302 "$(curl -s -o /dev/null -w '%{http_code}' $B/)"
# O `new URL()` do Node já normaliza `../`, então esse vetor chega como /etc/passwd e dá 404 (não
# vaza, mas por outro motivo). O que a guarda de prefixo realmente pega é o `..` CODIFICADO, que
# sobrevive ao parse e só vira `..` no decodeURIComponent.
espera "travessia codificada → 403"    403 "$(curl -s -o /dev/null -w '%{http_code}' --path-as-is "$B/%2e%2e%2f%2e%2e%2fetc/passwd")"
espera "travessia crua não vaza"       404 "$(curl -s -o /dev/null -w '%{http_code}' --path-as-is $B/front/../../../etc/passwd)"
kill $PID 2>/dev/null; wait $PID 2>/dev/null

echo "modo local NÃO liga fora de desenvolvimento:"
REVISAO_MODO=local REVISAO_AMBIENTE=Production REVISAO_OWNER=$DONO REVISAO_AUDIENCIA=/projects/0/x PORT=$PORTA \
  REVISAO_SITE="$PWD/examples/ola-mundo" \
  node review/api/server.ts >/tmp/node-prod.log 2>&1 & PID=$!
for i in $(seq 40); do curl -s $B/api/saude >/dev/null 2>&1 && break; sleep 0.5; done
espera "X-Dev-Email ignorado → 401"    401 "$(curl -s -o /dev/null -w '%{http_code}' -H "X-Dev-Email: $DONO" $B/api/eu)"
espera "e avisa no log"                0 "$(grep -qi 'IGNORADO' /tmp/node-prod.log; echo $?)"
espera "e-mail forjado → 401"          401 "$(curl -s -o /dev/null -w '%{http_code}' -H 'x-goog-authenticated-user-email: accounts.google.com:x@y' $B/api/eu)"
espera "JWT forjado → 401"             401 "$(curl -s -o /dev/null -w '%{http_code}' -H 'x-goog-iap-jwt-assertion: eyJhbGciOiJFUzI1NiJ9.eyJlbWFpbCI6ImhhY2tlckB4In0.abc' $B/api/eu)"
kill $PID 2>/dev/null; wait $PID 2>/dev/null

echo "sobe sem nuvem nenhuma (usuário, senha e um arquivo):"
# É o caminho de quem baixa a imagem: nenhuma variável do Google, nenhum projeto, nenhum IAP.
DADOS=$(mktemp -d); LOGIN=/tmp/cookies-contrato.txt; rm -f $LOGIN
REVISAO_AMBIENTE=Production REVISAO_OWNER=$DONO REVISAO_IDENTIDADE=senha REVISAO_BANCO=sqlite \
  REVISAO_PESSOAS=$DADOS/pessoas.db REVISAO_SQLITE=$DADOS/eventos.db PORT=$PORTA \
  REVISAO_SITE="$PWD/examples/ola-mundo" \
  node review/api/server.ts >/tmp/node-senha.log 2>&1 & PID=$!
for i in $(seq 40); do curl -s $B/api/saude >/dev/null 2>&1 && break; sleep 0.5; done

SENHA=$(grep -A2 'PRIMEIRO ACESSO' /tmp/node-senha.log | sed -n 's/.*senha: *//p')
espera "a primeira senha é dita uma vez" 0 "$([ -n "$SENHA" ] && echo 0 || echo 1)"
espera "e não é 'admin'"                 1 "$(echo "$SENHA" | grep -qx 'admin'; echo $?)"
entra() { curl -s -c $LOGIN -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -d "{\"email\":\"$DONO\",\"senha\":\"$1\"}" $B/api/entrar; }

espera "sem sessão → 401"                401 "$(curl -s -o /dev/null -w '%{http_code}' $B/api/eu)"
# Aqui não há IAP na borda: se o site estático não exigir sessão, a documentação inteira fica aberta
# a quem alcançar a porta — e quem subiu a imagem acreditando ter configurado login nem desconfia.
espera "a doc NÃO abre sem sessão"       302 "$(curl -s -o /dev/null -w '%{http_code}' $B/paginas/A01.html)"
espera "e manda para a tela de entrada"  0 "$(curl -s -D- -o /dev/null $B/paginas/A01.html | grep -qi 'location: /entrar'; echo $?)"
espera "guardando para onde ela ia"      0 "$(curl -s -D- -o /dev/null $B/paginas/A01.html | grep -q 'destino=%2Fpaginas%2FA01'; echo $?)"
espera "a tela de entrada abre → 200"    200 "$(curl -s -o /dev/null -w '%{http_code}' $B/entrar)"
espera "e ela não pede nada de fora"     1 "$(curl -s $B/entrar | grep -qE '<link|src=\"/front'; echo $?)"
espera "X-Dev-Email não vale aqui → 401" 401 "$(curl -s -o /dev/null -w '%{http_code}' -H "X-Dev-Email: $DONO" $B/api/eu)"
espera "senha errada → 401"              401 "$(entra 'nao-e-a-senha')"
espera "senha certa → 200"               200 "$(entra "$SENHA")"
espera "e a sessão identifica o owner"   owner "$(curl -s -b $LOGIN $B/api/eu | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).papel))")"
espera "e o owner aprova de verdade"     201 "$(curl -s -b $LOGIN -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -d '{"tipo":"aprovacao","pagina":"D01","caixa":"D01.1.4","digital":"abc123"}' $B/api/eventos)"
espera "a senha do primeiro acesso pede troca" true "$(curl -s -b $LOGIN $B/api/eu | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).precisaTrocarSenha))")"
espera "agora a doc abre → 200"          200 "$(curl -s -b $LOGIN -o /dev/null -w '%{http_code}' $B/paginas/A01.html)"
# O HTML NÃO pode ser cacheado: senão uma correção de texto não chega a quem já abriu a página —
# e, pior, a digital que o navegador calcula passa a ser de um texto que já mudou no disco.
espera "HTML não é cacheado"             0 "$(curl -s -b $LOGIN -D- -o /dev/null $B/paginas/A01.html | grep -qi 'cache-control: no-cache'; echo $?)"
espera "e /entrar já não tem o que fazer" 302 "$(curl -s -b $LOGIN -o /dev/null -w '%{http_code}' $B/entrar)"
espera "sair → 200"                      200 "$(curl -s -b $LOGIN -o /dev/null -w '%{http_code}' -X POST $B/api/sair)"
espera "e depois de sair → 401"          401 "$(curl -s -b $LOGIN -o /dev/null -w '%{http_code}' $B/api/eu)"
kill $PID 2>/dev/null; wait $PID 2>/dev/null

# O evento gravado tem de sobreviver ao desligamento — é a diferença entre sqlite e memória.
espera "o evento continua lá depois de desligar" 1 "$(node -e "
  const {DatabaseSync}=require('node:sqlite');
  console.log(new DatabaseSync('$DADOS/eventos.db').prepare('SELECT COUNT(*) c FROM events').get().c)")"
rm -rf $DADOS $LOGIN

echo "sem configuração, não sobe:"
# Fora de um projeto (sem doc-first.json) e sem variável: não há de onde tirar o owner.
mkdir -p /tmp/doc-first-vazio
REVISAO_SITE=/tmp/doc-first-vazio PORT=$PORTA timeout 15 node review/api/server.ts >/tmp/node-semcfg.log 2>&1
espera "sem owner em lugar nenhum → sai 1" 1 "$?"
espera "e diz o que falta"             0 "$(grep -qi 'REVISAO_OWNER' /tmp/node-semcfg.log; echo $?)"

echo; [ $FALHAS -eq 0 ] && echo "tudo certo" || { echo "$FALHAS falha(s)"; exit 1; }
