/**
 * Autenticação própria e persistência sem nuvem — o que permite o Doc First ser usado como o
 * Keycloak é: sobe, entra, trabalha.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { Pessoas } from '../api/users.ts';
import { IdentidadeSenha } from '../api/identity-password.ts';
import { RegistroSqlite } from '../api/store-sqlite.ts';

test('senha certa entra, errada não, e e-mail inexistente também não', async () => {
  const p = new Pessoas(':memory:');
  const senha = await p.criar('alguem@exemplo.org', 'Alguém');
  assert.ok(await p.conferir('alguem@exemplo.org', senha));
  assert.equal(await p.conferir('alguem@exemplo.org', senha + 'x'), null);
  assert.equal(await p.conferir('ninguem@exemplo.org', senha), null);
  assert.ok(await p.conferir('  Alguem@Exemplo.ORG  ', senha), 'e-mail não depende de caixa nem de espaço');
});

test('a senha nunca é guardada em texto', async () => {
  const p = new Pessoas('/tmp/teste-pessoas.db');
  try {
    const senha = await p.criar('x@exemplo.org', 'X', 'senha-secreta-de-teste');
    p.fechar();
    // Lê o arquivo bruto: a senha não pode estar lá em lugar nenhum.
    const { readFileSync } = await import('node:fs');
    const bruto = readFileSync('/tmp/teste-pessoas.db').toString('latin1');
    assert.equal(bruto.includes('senha-secreta-de-teste'), false, 'a senha apareceu no arquivo do banco');
    assert.ok(senha);
  } finally {
    rmSync('/tmp/teste-pessoas.db', { force: true });
    rmSync('/tmp/teste-pessoas.db-wal', { force: true });
    rmSync('/tmp/teste-pessoas.db-shm', { force: true });
  }
});

test('a primeira senha exige troca; depois de trocar, não', async () => {
  const p = new Pessoas(':memory:');
  const senha = await p.criar('admin@exemplo.org', 'Admin');
  assert.equal((await p.conferir('admin@exemplo.org', senha)).precisaTrocarSenha, true);
  await p.trocarSenha('admin@exemplo.org', 'uma-senha-bem-longa');
  assert.equal((await p.conferir('admin@exemplo.org', 'uma-senha-bem-longa')).precisaTrocarSenha, false);
  assert.equal(await p.conferir('admin@exemplo.org', senha), null, 'a senha antiga tem de parar de valer');
});

test('senha curta é recusada', async () => {
  const p = new Pessoas(':memory:');
  await p.criar('x@exemplo.org', 'X');
  await assert.rejects(() => p.trocarSenha('x@exemplo.org', 'curta'), /12 caracteres/);
});

test('sessão: abre, vale, e para de valer ao sair', async () => {
  const p = new Pessoas(':memory:');
  const senha = await p.criar('x@exemplo.org', 'X');
  const id = new IdentidadeSenha(p, { seguro: false });
  const r = await id.entrar('x@exemplo.org', senha);
  assert.ok(r);
  assert.equal(id.daRequisicao({ cookie: `docfirst_sessao=${r.sessao}` })?.email, 'x@exemplo.org');
  assert.equal(id.daRequisicao({ cookie: 'docfirst_sessao=inventado' }), null);
  assert.equal(id.daRequisicao({}), null);
  p.fecharSessao(r.sessao);
  assert.equal(id.daRequisicao({ cookie: `docfirst_sessao=${r.sessao}` }), null, 'sessão encerrada não vale');
});

test('o cookie da sessão não é legível por JavaScript nem viaja para outro site', () => {
  const id = new IdentidadeSenha(new Pessoas(':memory:'), { seguro: true });
  const cab = id.cabecalhoDeSessao('abc');
  assert.match(cab, /HttpOnly/, 'sem HttpOnly, um XSS rouba a sessão');
  assert.match(cab, /SameSite=Strict/, 'sem SameSite, há CSRF por navegação');
  assert.match(cab, /Secure/, 'fora de desenvolvimento a sessão não pode viajar em claro');
});

test('o primeiro acesso só é criado uma vez', async () => {
  const id = new IdentidadeSenha(new Pessoas(':memory:'), { seguro: false });
  assert.ok(await id.primeiroAcesso('dono@exemplo.org'));
  assert.equal(await id.primeiroAcesso('outro@exemplo.org'), null, 'não recria quando já há alguém');
});

test('o banco RECUSA alterar e apagar evento', async () => {
  const caminho = '/tmp/teste-eventos.db';
  try {
    const r = new RegistroSqlite(caminho);
    await r.incluir({ tipo: 'aprovacao', pagina: 'D01', caixa: 'D01.1.1', digital: 'abc', texto: null, foto: null, dados: null }, 'ale@exemplo.org');
    r.fechar();
    // Abre por fora, como faria quem tem acesso ao disco.
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(caminho);
    assert.throws(() => db.exec('DELETE FROM eventos'), /rastro/, 'apagar tem de ser recusado');
    assert.throws(() => db.exec("UPDATE eventos SET autor='outro@x'"), /rastro/, 'alterar tem de ser recusado');
    assert.equal(db.prepare('SELECT COUNT(*) c FROM eventos').get().c, 1);
    db.close();
  } finally {
    for (const s of ['', '-wal', '-shm']) rmSync(caminho + s, { force: true });
  }
});

test('o registro em sqlite guarda e devolve o evento inteiro', async () => {
  const r = new RegistroSqlite(':memory:');
  const e = await r.incluir({ tipo: 'pedido', pagina: 'D01', caixa: 'D01.1.1', digital: 'x',
    texto: 'trocar termo', foto: 'texto de então', dados: { categoria: 'termo' } }, 'revisora@exemplo.org');
  const [lido] = await r.listar('D01');
  assert.deepEqual({ ...lido }, { ...e }, 'o que sai tem de ser o que entrou');
  assert.deepEqual(lido.dados, { categoria: 'termo' }, 'dados voltam como objeto, não como texto');
  assert.equal((await r.listar('D02')).length, 0, 'o filtro por página funciona');
});
