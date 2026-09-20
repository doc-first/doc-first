import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, sep } from 'node:path';
import { readFileSync } from 'node:fs';
import { createCycle } from '../core/cycle.js';
import { doHistorico, paraOContrato, estadoAtual, estadoEmPortugues } from '../core/legacy.js';
import { readConfig } from '../core/config.js';
import { createRoles } from '../core/roles.js';
import { overLimit, validCommit } from '../core/limits.js';
import { RegistroEmMemoria, RegistroFirestore } from './store.ts';
import { RegistroSqlite } from './store-sqlite.ts';
import { Pessoas } from './users.ts';
import { IdentidadeSenha } from './identity-password.ts';
import { Identidade } from './identity-iap.ts';
import { TIPOS_DE_EVENTO, type Evento, type NovoEvento, type Registro } from './types.ts';

/**
 * Serviço da metodologia Doc First: serve o site e registra os eventos de revisão.
 *
 * O IAP protege na borda; a API valida de novo quem é (defesa em profundidade). As regras de negócio
 * — ciclo, papéis, limites — vêm de `review/core/`, o MESMO código que o navegador importa.
 */

// A configuração do PROJETO vem de doc-first.json; variável de ambiente vence o arquivo. O motor
// não conhece nome de produto, e-mail nem projeto na nuvem — ele pergunta.
const raizDoProjeto = process.env.REVISAO_SITE ?? join(import.meta.dirname, '..', '..');
const doProjeto = readConfig(raizDoProjeto, { readFile: (p: string) => readFileSync(p, 'utf8') }, process.env);

const cfg = {
  porta: Number(process.env.PORT ?? 8080),
  site: raizDoProjeto,
  projeto: doProjeto.project,
  owner: doProjeto.owner,
  admins: doProjeto.admins,
  modo: process.env.REVISAO_MODO,
  ambiente: process.env.NODE_ENV === 'development' ? 'Development' : (process.env.REVISAO_AMBIENTE ?? 'Production'),
};

function log(nivel: string, evento: string, extra: Record<string, unknown> = {}) {
  // Uma linha JSON por fato: o Cloud Logging entende severity, e dá para achar um evento pelo id.
  // A API anterior tinha três chamadas de log no total, nenhuma no caminho de escrita.
  console.log(JSON.stringify({ severity: nivel, evento, hora: new Date().toISOString(), ...extra }));
}

// ---------------------------------------------------------------- configuração que derruba na subida
/**
 * Como as pessoas entram.
 *   senha | usuário e senha no próprio serviço. É o "sobe a imagem e usa", sem nuvem nenhuma.
 *   iap   | Google Cloud IAP. Exige REVISAO_AUDIENCIA.
 *   dev   | cabeçalho X-Dev-Email, só em Development. Abrir o navegador e trabalhar, sem login.
 *
 * O padrão nunca é `dev` fora de Development: um serviço que aceita "sou quem eu disser que sou"
 * em produção não é um descuido pequeno. Fora de Development, IAP quando há audiência e senha no
 * resto — quem sobe a imagem sem configurar nada cai no login, que é o pior caso aceitável.
 */
const comoEntrar = process.env.REVISAO_IDENTIDADE
  ?? (cfg.ambiente === 'Development' ? 'dev' : process.env.REVISAO_AUDIENCIA ? 'iap' : 'senha');

let papeis: ReturnType<typeof createRoles>;
let identidade: Identidade | null = null;
const ciclo = createCycle(JSON.parse(readFileSync(new URL('../cycle.json', import.meta.url), 'utf8')));

// O núcleo fala inglês; a API ainda grava em pt-BR. A tradução acontece AQUI, na entrada do núcleo,
// e em lugar nenhum mais — ver review/core/legacy.js.
const paraONucleo = (todos: Evento[]) => todos.map(doHistorico);

try {
  // Sem valor padrão de propósito: num pacote distribuído, um e-mail nosso aqui faria quem esquecesse
  // de configurar subir um serviço com o NOSSO owner.
  papeis = createRoles(cfg.owner, cfg.admins);
  // O IAP só é construído quando é ele quem manda: exigir REVISAO_AUDIENCIA de quem entra por senha
  // impediria o caso "sobe e usa", que é o ponto da identidade por senha.
  if (comoEntrar === 'iap' || comoEntrar === 'dev') {
    identidade = new Identidade({
      audiencia: process.env.REVISAO_AUDIENCIA, modo: cfg.modo,
      ambiente: cfg.ambiente, // string vazia é uma escolha: 'não identifique ninguém', que o teste usa para exercitar o 401
      emailDeDev: process.env.REVISAO_DEV_EMAIL !== undefined ? process.env.REVISAO_DEV_EMAIL || undefined : (doProjeto.actAs ?? undefined),
    });
  } else if (comoEntrar !== 'senha') {
    throw new Error(`REVISAO_IDENTIDADE="${comoEntrar}" não existe (use senha, iap ou dev)`);
  }
} catch (erro) {
  console.error('configuração inválida: ' + (erro instanceof Error ? erro.message : String(erro)));
  process.exit(1);
}

/**
 * Onde os eventos ficam. `sqlite` é o padrão de quem sobe a ferramenta sem nuvem: um arquivo, sem
 * dependência externa, e com o banco RECUSANDO update e delete — "nada se apaga" vira garantia.
 *   memoria  | some ao parar. Para desenvolver e testar.
 *   sqlite   | um arquivo no disco. É o modo "sobe e usa".
 *   firestore| Google Cloud. Exige REVISAO_PROJETO.
 */
const ondeGuardar = process.env.REVISAO_BANCO ?? (cfg.modo === 'local' ? 'memoria' : 'sqlite');
const registro: Registro = (() => {
  switch (ondeGuardar) {
    case 'memoria': return new RegistroEmMemoria();
    case 'sqlite': return new RegistroSqlite(process.env.REVISAO_SQLITE ?? './dados/eventos.db');
    case 'firestore':
      if (!cfg.projeto) { console.error('configuração inválida: firestore exige REVISAO_PROJETO'); process.exit(1); }
      return new RegistroFirestore(cfg.projeto);
    default:
      console.error(`configuração inválida: REVISAO_BANCO="${ondeGuardar}" (use memoria, sqlite ou firestore)`);
      process.exit(1);
  }
})();

let porSenha: IdentidadeSenha | null = null;
if (comoEntrar === 'senha') {
  const pessoas = new Pessoas(process.env.REVISAO_PESSOAS ?? './dados/pessoas.db');
  porSenha = new IdentidadeSenha(pessoas, { seguro: cfg.ambiente !== 'Development' });
  pessoas.limparSessoesVencidas();

  // Primeira subida: cria o acesso do owner e mostra a senha UMA vez. Senha fixa tipo "admin" é
  // convidativa, e ferramenta interna fica anos no ar sem ninguém olhar.
  const senha = await porSenha.primeiroAcesso(cfg.owner!, 'Dono');
  if (senha) {
    console.log('\n' + '='.repeat(72));
    console.log('  PRIMEIRO ACESSO — anote agora, esta senha não será mostrada de novo:');
    console.log(`     entrar com: ${cfg.owner}`);
    console.log(`     senha:      ${senha}`);
    console.log('  Você terá de trocá-la ao entrar.');
    console.log('='.repeat(72) + '\n');
  }
}

// ---------------------------------------------------------------- utilidades
const json = (res: ServerResponse, codigo: number, corpo: unknown) => {
  const texto = JSON.stringify(corpo);
  res.writeHead(codigo, { 'content-type': 'application/json; charset=utf-8' });
  res.end(texto);
};

const TIPOS_MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.pdf': 'application/pdf', '.ico': 'image/x-icon',
};

async function corpoJson(req: IncomingMessage): Promise<unknown> {
  const partes: Buffer[] = [];
  let tamanho = 0;
  for await (const p of req) {
    tamanho += p.length;
    if (tamanho > 1_000_000) throw new Error('corpo grande demais');   // teto antes de parsear
    partes.push(p);
  }
  return partes.length ? JSON.parse(Buffer.concat(partes).toString('utf8')) : {};
}

/** Pedido + situação calculada pelo servidor. O front não reimplementa o ciclo. */
const comSituacao = (e: Evento, todos: Evento[]) => ({
  ...e,
  situacao: paraOContrato(ciclo.status(ciclo.currentState(e.id, paraONucleo(todos), papeis.isAdmin(e.autor)))),
});

// ---------------------------------------------------------------- rotas da API
async function api(req: IncomingMessage, res: ServerResponse, url: URL, email: string) {
  const rota = url.pathname.replace(/^\/api/, '');

  // ---------------------------------------------------------------- entrar e sair (identidade por senha)
  if (porSenha && req.method === 'POST' && rota === '/sair') {
    porSenha.pessoas.fecharSessao(req.headers.cookie?.match(/docfirst_sessao=([^;]+)/)?.[1]);
    res.setHeader('set-cookie', porSenha.cabecalhoDeSaida());
    return json(res, 200, { ok: true });
  }

  if (porSenha && req.method === 'POST' && rota === '/trocar-senha') {
    const corpo = (await corpoJson(req)) as { atual?: string; nova?: string };
    const conferida = await porSenha.pessoas.conferir(email, corpo.atual ?? '');
    if (!conferida) return json(res, 403, { erro: 'a senha atual não confere' });
    try {
      await porSenha.pessoas.trocarSenha(email, corpo.nova ?? '');
    } catch (erro) {
      return json(res, 400, { erro: erro instanceof Error ? erro.message : 'senha inválida' });
    }
    log('INFO', 'senha_trocada', { email });
    return json(res, 200, { ok: true });
  }

  if (req.method === 'GET' && rota === '/eu') {
    return json(res, 200, {
      email,
      // O núcleo devolve a CHAVE do papel; `outro` é o nome que o contrato publicou e o front usa
      // para estilizar (shell.js). Andaime, como o resto: morre quando o front falar inglês.
      papel: ({ owner: 'owner', admin: 'admin', other: 'outro' } as Record<string, string>)[papeis.roleOf(email)] ?? 'outro',
      podeAprovar: papeis.canApprove(email),
      podeTriar: papeis.canTriage(email),
      owner: papeis.isOwner(email),
      admins: papeis.admins,
      dono: papeis.isAdmin(email),          // ⚠️ compatibilidade; sai quando o front migrar de vez
      // Só existe quando se entra por senha. Sem isto, recarregar a página esqueceria que a senha
      // ainda é a do primeiro acesso — e a tela de troca só apareceria no login.
      ...(porSenha ? { precisaTrocarSenha: porSenha.daRequisicao(req.headers)?.precisaTrocarSenha ?? false } : {}),
    });
  }

  if (req.method === 'GET' && rota === '/eventos') {
    const pagina = url.searchParams.get('pagina');
    // Os eventos de um pedido ficam TODOS na página dele (a triagem e o agente gravam com a página do
    // pedido), então a consulta filtrada basta — não é preciso varrer a coleção.
    const eventos = await registro.listar(pagina);
    return json(res, 200, eventos.map((e) => (e.tipo === 'pedido' ? comSituacao(e, eventos) : e)));
  }

  const umEvento = rota.match(/^\/eventos\/([A-Za-z0-9_-]+)$/);
  if (req.method === 'GET' && umEvento) {
    const achado = (await registro.listar(null)).find((e) => e.id === umEvento[1]);
    return achado ? json(res, 200, achado) : json(res, 404, { erro: 'evento não encontrado', id: umEvento[1] });
  }

  if (req.method === 'GET' && rota === '/pedidos/abertos') {
    const todos = await registro.listar(null);
    const porPagina = new Map<string, Evento[]>();
    for (const e of todos) porPagina.set(e.pagina, [...(porPagina.get(e.pagina) ?? []), e]);
    let triar = 0;
    for (const [, daPagina] of porPagina) {
      triar += daPagina.filter((e) => e.tipo === 'pedido')
        .filter((p) => ciclo.currentState(p.id, paraONucleo(daPagina), papeis.isAdmin(p.autor)) === 'open').length;
    }
    return json(res, 200, { triar });
  }

  if (req.method === 'POST' && rota === '/eventos') {
    const novo = (await corpoJson(req)) as NovoEvento;
    const podeAprovar = papeis.canApprove(email);

    if (!TIPOS_DE_EVENTO.has(novo.tipo)) return json(res, 400, { erro: 'tipo desconhecido', tipo: novo.tipo });
    if (novo.tipo === 'aprovacao' && (!novo.caixa || !novo.digital)) {
      return json(res, 400, { erro: 'aprovação precisa de caixa e digital' });
    }
    // Aprovar é de owner e admin: o ✓ deles vira trava no repositório e manda o agente aplicar.
    if (novo.tipo === 'aprovacao' && !podeAprovar) {
      return json(res, 403, { erro: 'só owner e admin aprovam; use pedir alteração ou comentar' });
    }
    if (['pedido', 'comentario', 'complemento'].includes(novo.tipo) && !novo.texto?.trim()) {
      return json(res, 400, { erro: 'escreva o texto' });
    }
    // O núcleo lê o evento com os nomes dele; a API ainda fala pt-BR. Traduz na entrada, aqui.
    const limite = overLimit(doHistorico(novo), doProjeto.pageExamples);
    if (limite) return json(res, 400, { erro: limite });

    if (novo.tipo === 'pedido_estado' || novo.tipo === 'complemento') {
      const pedidoId = novo.dados?.pedido;
      if (!pedidoId) return json(res, 400, { erro: 'informe dados.pedido' });
      const daPagina = await registro.listar(novo.pagina);
      const pedido = daPagina.find((e) => e.id === pedidoId && e.tipo === 'pedido');
      if (!pedido) return json(res, 404, { erro: 'pedido não encontrado nesta página' });
      // `atual` é a língua do núcleo (inglês); `atualPt` é a do contrato, que ainda é pt-BR e viaja
      // para o front e para o registro. Duas variáveis em vez de converter no meio do caminho: o
      // erro que isto evita é comparar uma língua com a outra e nunca casar.
      const atual = ciclo.currentState(pedidoId, paraONucleo(daPagina), papeis.isAdmin(pedido.autor));
      const atualPt = estadoEmPortugues(atual);

      if (novo.tipo === 'complemento') {
        if (email !== pedido.autor && !podeAprovar) {
          return json(res, 403, { erro: 'só quem pediu, ou um admin, acrescenta detalhes' });
        }
        if (!ciclo.acceptsSupplement(atual)) {
          return json(res, 409, { erro: `pedido ${atualPt}: para mudar algo já aprovado, faça um novo pedido`, estado: atualPt });
        }
      } else {
        const paraPt = novo.dados?.estado as string | undefined;
        if (!paraPt) return json(res, 400, { erro: 'informe dados.estado' });
        const para = estadoAtual(paraPt);
        if (!ciclo.exists(para)) return json(res, 400, { erro: 'estado desconhecido' });
        const doAgente = ciclo.agentStates.includes(para);
        if (!podeAprovar && !(identidade?.modoLocal && doAgente)) {
          return json(res, 403, { erro: 'só owner e admin fazem a triagem' });
        }
        if (ciclo.requiresReason(para) && !novo.texto?.trim()) {
          return json(res, 400, { erro: 'diga o motivo ou a pergunta' });
        }
        if (ciclo.requiresCommit(para) && !validCommit(novo.dados)) {
          return json(res, 400, { erro: 'aplicado precisa do commit (7 a 40 caracteres hexadecimais)' });
        }
        if (!ciclo.canGo(atual, para)) {
          return json(res, 409, { erro: `não dá para ir de ${atualPt} para ${paraPt}`, estado: atualPt });
        }
        // Trava de corrida: registrar de onde a mudança saiu faz o próprio histórico ser o guarda.
        // Grava em pt-BR, como o resto do registro: quem lê traduz (review/core/legacy.js).
        novo.dados = { ...novo.dados, de: atualPt };
      }
    }

    const e = await registro.incluir(novo, email);
    log('INFO', 'evento_incluido', {
      id: e.id, tipo: e.tipo, pagina: e.pagina, caixa: e.caixa, autor: e.autor,
      de: e.dados?.de, para: e.dados?.estado,
    });
    res.setHeader('location', `/api/eventos/${e.id}`);
    return json(res, 201, e);
  }

  return json(res, 405, { erro: 'método ou rota não existe', rota });
}

/** A única página servida sem sessão. Autocontida de propósito: ver review/api/login.html. */
const TELA_DE_ENTRADA = '/entrar';

// ---------------------------------------------------------------- site estático
async function estatico(url: URL, res: ServerResponse) {
  let caminho = decodeURIComponent(url.pathname);
  // Para onde a raiz leva vem do doc-first.json (`conteudo.inicio`). Estava fixo em
  // `/front/index.html`, que é a página inicial DESTE projeto, não do método.
  if (caminho === '/') return (res.writeHead(302, { location: doProjeto.home }), res.end());

  // O painel de revisão é do MOTOR, e mora junto do servidor — não dentro do conteúdo. Sem esta
  // rota, apontar REVISAO_SITE para uma documentação montada de fora deixaria o painel sem os
  // próprios arquivos: a página carregaria, e nenhum botão de revisão apareceria.
  // A pasta pode não existir (é o caso de quem ainda serve o painel de dentro do site) — aí este
  // ramo não faz nada e o caminho segue para o site normal.
  // `web` é o painel; `core` vem junto porque o core-web.js é um MÓDULO e importa
  // `../core/fingerprint.js` — o navegador resolve isso contra a URL, então /review/core/ precisa
  // responder ou o painel carrega sem o núcleo e nenhuma digital é calculada.
  for (const pasta of ['web', 'core']) {
    const prefixo = `/review/${pasta}/`;
    if (!caminho.startsWith(prefixo)) continue;
    const base = normalize(join(import.meta.dirname, '..', pasta));
    const seguro = normalize(join(base, caminho.slice(prefixo.length)));
    if (!seguro.startsWith(base + sep)) break;        // fora da pasta do motor
    try {
      await stat(seguro);
      return servirArquivo(seguro, res);
    } catch { break; /* não existe aqui: segue para o site */ }
  }

  // normalize + verificação de prefixo: sem isso, `/../../etc/passwd` sairia da pasta do site.
  const alvo = normalize(join(cfg.site, caminho));
  if (!alvo.startsWith(normalize(cfg.site) + sep)) {
    return json(res, 403, { erro: 'caminho fora do site' });
  }
  try {
    const info = await stat(alvo);
    if (info.isDirectory()) return estatico(new URL(url.href.replace(/\/?$/, '/index.html')), res);
    return servirArquivo(alvo, res, caminho);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('não encontrado');
  }
}

/** Devolve um arquivo do disco. Usado pelo site e pelos arquivos do próprio motor. */
async function servirArquivo(alvo: string, res: ServerResponse, urlPath = '') {
  const ext = extname(alvo).toLowerCase();
  // O tema (fontes e ícones) não muda: cachear de verdade. Com no-cache o navegador revalidava os
  // ícones do menu a cada navegação, e como eles entram por mask-image, o menu piscava.
  const cache = urlPath.includes('/tema/') ? 'public, max-age=31536000, immutable' : 'no-cache';
  res.writeHead(200, {
    'content-type': TIPOS_MIME[ext] ?? 'application/octet-stream',
    'cache-control': cache,
    'x-robots-tag': 'noindex, nofollow',
  });
  res.end(await readFile(alvo));
}

// ---------------------------------------------------------------- servidor
const servidor = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  try {
    if (url.pathname === '/api/saude') return json(res, 200, { ok: true });

    // /api/entrar é a única rota da API sem sessão: é ela que cria a sessão.
    if (porSenha && url.pathname === '/api/entrar' && req.method === 'POST') {
      const corpo = (await corpoJson(req)) as { email?: string; senha?: string };
      const r = await porSenha.entrar(corpo.email ?? '', corpo.senha ?? '');
      if (!r) {
        // A mesma resposta para e-mail inexistente e senha errada: dizer qual dos dois falhou
        // entrega quem tem conta. O tempo de resposta também é igual (ver pessoas.ts).
        log('AVISO', 'entrada_recusada', { email: corpo.email });
        return json(res, 401, { erro: 'e-mail ou senha não conferem' });
      }
      res.setHeader('set-cookie', porSenha.cabecalhoDeSessao(r.sessao));
      log('INFO', 'entrou', { email: r.pessoa.email, precisaTrocarSenha: r.pessoa.precisaTrocarSenha });
      return json(res, 200, { email: r.pessoa.email, nome: r.pessoa.nome, precisaTrocarSenha: r.pessoa.precisaTrocarSenha });
    }

    if (url.pathname.startsWith('/api/')) {
      const email = porSenha
        ? porSenha.daRequisicao(req.headers)?.email ?? null
        : await identidade!.email(req.headers);
      if (!email) return json(res, 401, { erro: 'não autenticado' });
      return await api(req, res, url, email);
    }

    // No modo IAP quem barra é a borda, antes de chegar aqui. No modo senha não há borda nenhuma:
    // sem esta guarda, a documentação inteira ficava aberta a quem alcançasse a porta — e quem sobe
    // a imagem acreditando que configurou login não teria como desconfiar. Achado testando.
    if (porSenha && !porSenha.daRequisicao(req.headers)) {
      if (url.pathname === TELA_DE_ENTRADA) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(await readFile(new URL('./login.html', import.meta.url)));
      }
      const destino = encodeURIComponent(url.pathname + url.search);
      return (res.writeHead(302, { location: `${TELA_DE_ENTRADA}?destino=${destino}` }), res.end());
    }
    // Já com sessão, a tela de entrada não tem o que fazer: leva para o site.
    if (porSenha && url.pathname === TELA_DE_ENTRADA) {
      return (res.writeHead(302, { location: '/' }), res.end());
    }

    return await estatico(url, res);
  } catch (erro) {
    const id = crypto.randomUUID().slice(0, 8);
    log('ERROR', 'erro_nao_tratado', { id, caminho: url.pathname, motivo: erro instanceof Error ? erro.message : String(erro) });
    json(res, 500, { erro: 'erro interno', id });   // o id liga a tela ao log
  }
});

servidor.listen(cfg.porta, () => {
  log('INFO', 'servidor_no_ar', {
    porta: cfg.porta, ambiente: cfg.ambiente, identidade: comoEntrar, banco: ondeGuardar,
    modoLocal: identidade?.modoLocal ?? false, site: cfg.site,
  });
});
