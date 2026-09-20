#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { readConfig } from '../core/config.js';
import { Fonte } from './remote.ts';
import * as pedidos from './requests.ts';
import * as validacao from './validation.ts';

/**
 * A ferramenta do agente da metodologia Doc First.
 *
 * Um comando só, em vez de dois scripts soltos: `doc-first <comando>`. Lê os pedidos que os revisores
 * fizeram no site, mostra o contexto, mede o impacto antes de alterar, e traz para o repositório os ✓
 * que o dono deu. NUNCA altera conteúdo por conta própria.
 *
 * Usa o MESMO núcleo (review/core/) que o servidor e o navegador: o ciclo do pedido e a digital do
 * texto são um arquivo só, não três implementações que precisam continuar iguais.
 */

const AJUDA = `
doc-first — ferramenta do agente da metodologia Doc First

  Revisão (o que chegou do site)
    listar [--todos]            pedidos APROVADOS pelo dono, a aplicar (ou todos)
    ver <id>                    o pedido, o texto do trecho antes e agora, e a conversa
    impacto <id> [--termo x]    onde mais o assunto aparece, e o que está validado
    resumo                      aprovações e pedidos por página
    estado <id> <novo> "msg"    registra o andamento (o revisor vê no painel)
                                  --commit <sha>    obrigatório em "aplicado"
                                  --trechos D01.1.4,D02.3.1

  Trava de validação (o ✓ humano)
    sincronizar                 traz para o repositório os ✓ que o dono deu no site
    conferir                    acusa trecho validado que mudou, e marca sem registro
    semaforo                    o estado da documentação inteira: 🟢 🟡 🔴 ⚪
    se-eu-mexer <id>            o que mais precisa de conferência se eu editar isto

  Opções
    --local                     falar com o servidor local em vez da nuvem
    --raiz <caminho>            raiz do projeto (padrão: o diretório atual)
    --banco <arquivo>           lê os eventos de um SQLite (o modo sem nuvem)

  Variáveis
    REVISAO_OWNER               quem aprova; é o ✓ dele que vira trava
    REVISAO_PROJETO             projeto do Firestore, na nuvem
    REVISAO_CONTA               fixa a conta do gcloud (padrão: a primeira que emitir token)
`;

async function principal() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      local: { type: 'boolean', default: false },
      todos: { type: 'boolean', default: false },
      termo: { type: 'string', multiple: true },
      raiz: { type: 'string' },
      commit: { type: 'string' },
      trechos: { type: 'string' },
      banco: { type: 'string' },
      so: { type: 'string' },
      ajuda: { type: 'boolean', short: 'h', default: false },
    },
  });

  const [comando, arg] = positionals;
  if (values.ajuda || !comando) { console.log(AJUDA.trim()); return 0; }

  const raiz = values.raiz ?? process.cwd();
  // A configuração do projeto (nome, dono, projeto na nuvem) vem do doc-first.json da raiz.
  const doProjeto = readConfig(raiz, { readFile: (p: string) => readFileSync(p, 'utf8') }, process.env);
  if (doProjeto.owner) process.env.REVISAO_OWNER ??= doProjeto.owner;
  const fonte = new Fonte({
    local: values.local,
    projeto: doProjeto.project ?? undefined,
    conta: doProjeto.account ?? undefined,
    banco: values.banco,
  });

  switch (comando) {
    case 'listar':      await pedidos.listar(raiz, fonte, values.todos); return 0;
    case 'ver':         await pedidos.ver(raiz, fonte, exige(arg, 'ver <id>')); return 0;
    case 'impacto':     await pedidos.impacto(raiz, fonte, exige(arg, 'impacto <id>'), values.termo ?? []); return 0;
    case 'resumo':      await pedidos.resumo(raiz, fonte); return 0;
    case 'estado':      await pedidos.estado(raiz, fonte, exige(arg, 'estado <id> <estado> "mensagem"'),
                          exige(positionals[2], 'estado <id> <estado> "mensagem"'),
                          exige(positionals[3], 'estado <id> <estado> "mensagem"'),
                          { commit: values.commit, caixas: values.trechos }); return 0;
    case 'sincronizar': await validacao.sincronizar(raiz, fonte); return 0;
    case 'conferir':    return (await validacao.conferir(raiz)) ? 1 : 0;
    case 'semaforo':    await validacao.mostrarSemaforo(raiz, { so: values.so }); return 0;
    case 'se-eu-mexer': return validacao.seEuMexer(raiz, exige(arg, 'se-eu-mexer <id>'));
    default:
      console.error(`comando desconhecido: ${comando}\n`);
      console.error(AJUDA.trim());
      return 2;
  }
}

function exige(valor: string | undefined, uso: string): string {
  if (!valor) { console.error(`falta o argumento. Uso: doc-first ${uso}`); process.exit(2); }
  return valor;
}

principal()
  .then((codigo) => process.exit(codigo))
  .catch((erro) => {
    console.error('✗ ' + (erro instanceof Error ? erro.message : String(erro)));
    process.exit(1);
  });
