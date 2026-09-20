#!/usr/bin/env bash
# Sobe o site + a API na sua máquina, igual ao que roda na nuvem, com dados de TESTE em memória.
# Nada vai para o Firestore; ao parar (Ctrl+C), os eventos de teste somem.
# As páginas vêm direto do repositório: editou, recarregue o navegador.
# Uso:  bash review/run-local.sh              → http://localhost:8095
#       COMO=revisora@exemplo.org bash review/run-local.sh   → simula outra pessoa
set -euo pipefail
RAIZ=$(cd "$(dirname "$0")/.." && pwd)
cd "$RAIZ"
# Quem aprova e quem você finge ser vêm do doc-first.json do projeto — o motor não tem e-mail fixo.
leia() { node -e "
const {lerConfig}=await import('./review/core/config.js');
const fs=await import('node:fs');
const c=lerConfig(process.cwd(),{leArquivo:p=>fs.readFileSync(p,'utf8')},process.env);
console.log(c[process.argv[1]] ?? '');" --input-type=module "$1" 2>/dev/null; }
DONO=${REVISAO_OWNER:-$(leia owner)}
COMO=${COMO:-${REVISAO_DEV_EMAIL:-$(leia comoQuem)}}
PORTA=${PORTA:-$(leia porta)}; PORTA=${PORTA:-8095}
[ -n "$DONO" ] || { echo "✗ falta o owner: ponha em doc-first.json ou em REVISAO_OWNER."; exit 1; }

# Se a porta já estiver ocupada, o processo ANTIGO continua respondendo — e você fica testando o
# binário anterior sem saber. Aconteceu duas vezes em 17/09, e uma delas quase me fez desfazer uma
# correção que estava certa. Melhor não subir do que subir uma mentira.
if ss -ltn 2>/dev/null | grep -q ":$PORTA "; then
  PID=$(ss -ltnp 2>/dev/null | grep ":$PORTA " | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2)
  echo "✗ a porta $PORTA já está ocupada (pid ${PID:-?})."
  echo "  O que responde ali é o processo ANTIGO, não o código que você acabou de mudar."
  echo "  Pare com:  kill ${PID:-<pid>}      ou use outra:  PORTA=8096 bash review/run-local.sh"
  exit 1
fi

[ -d node_modules ] || { echo "instalando dependências..."; npm install --silent; }
( cd front && python3 gerar_index.py >/dev/null )

echo "Doc First local → http://localhost:$PORTA   (você está como: $COMO · dados de teste, somem ao parar)"
exec env REVISAO_MODO=local REVISAO_AMBIENTE=Development REVISAO_OWNER="$DONO" \
  REVISAO_DEV_EMAIL="$COMO" REVISAO_SITE="$RAIZ" PORT="$PORTA" \
  node review/api/server.ts
