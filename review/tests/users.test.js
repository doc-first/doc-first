/**
 * Own authentication and storage with no cloud — what lets Doc First be used the way Keycloak is:
 * bring it up, log in, work.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Pessoas } from '../api/users.ts';
import { IdentidadeSenha } from '../api/identity-password.ts';
import { RegistroSqlite } from '../api/store-sqlite.ts';

test('the right password gets in, the wrong one does not, and neither does an unknown e-mail', async () => {
  const p = new Pessoas(':memory:');
  const senha = await p.criar('alguem@exemplo.org', 'Someone');
  assert.ok(await p.conferir('alguem@exemplo.org', senha));
  assert.equal(await p.conferir('alguem@exemplo.org', senha + 'x'), null);
  assert.equal(await p.conferir('ninguem@exemplo.org', senha), null);
  assert.ok(await p.conferir('  Alguem@Exemplo.ORG  ', senha), 'the e-mail depends on neither case nor spacing');
});

test('the password is never stored as text', async () => {
  const p = new Pessoas('/tmp/teste-pessoas.db');
  try {
    const senha = await p.criar('x@exemplo.org', 'X', 'secret-test-password');
    p.fechar();
    // Read the raw file: the password cannot be anywhere in it.
    const { readFileSync } = await import('node:fs');
    const bruto = readFileSync('/tmp/teste-pessoas.db').toString('latin1');
    assert.equal(bruto.includes('secret-test-password'), false, 'the password showed up in the database file');
    assert.ok(senha);
  } finally {
    rmSync('/tmp/teste-pessoas.db', { force: true });
    rmSync('/tmp/teste-pessoas.db-wal', { force: true });
    rmSync('/tmp/teste-pessoas.db-shm', { force: true });
  }
});

test('the first password demands a change; once changed, it does not', async () => {
  const p = new Pessoas(':memory:');
  const senha = await p.criar('admin@exemplo.org', 'Admin');
  assert.equal((await p.conferir('admin@exemplo.org', senha)).precisaTrocarSenha, true);
  await p.trocarSenha('admin@exemplo.org', 'a-very-long-password');
  assert.equal((await p.conferir('admin@exemplo.org', 'a-very-long-password')).precisaTrocarSenha, false);
  assert.equal(await p.conferir('admin@exemplo.org', senha), null, 'the old password has to stop working');
});

test('a short password is refused', async () => {
  const p = new Pessoas(':memory:');
  await p.criar('x@exemplo.org', 'X');
  await assert.rejects(() => p.trocarSenha('x@exemplo.org', 'short'), /12 caracteres/);
});

test('session: it opens, it holds, and it stops holding on logout', async () => {
  const p = new Pessoas(':memory:');
  const senha = await p.criar('x@exemplo.org', 'X');
  const id = new IdentidadeSenha(p, { seguro: false });
  const r = await id.entrar('x@exemplo.org', senha);
  assert.ok(r);
  assert.equal(id.daRequisicao({ cookie: `docfirst_sessao=${r.sessao}` })?.email, 'x@exemplo.org');
  assert.equal(id.daRequisicao({ cookie: 'docfirst_sessao=made-up' }), null);
  assert.equal(id.daRequisicao({}), null);
  p.fecharSessao(r.sessao);
  assert.equal(id.daRequisicao({ cookie: `docfirst_sessao=${r.sessao}` }), null, 'a closed session is worth nothing');
});

test('the session cookie is not readable by JavaScript and does not travel to another site', () => {
  const id = new IdentidadeSenha(new Pessoas(':memory:'), { seguro: true });
  const cab = id.cabecalhoDeSessao('abc');
  assert.match(cab, /HttpOnly/, 'without HttpOnly, an XSS steals the session');
  assert.match(cab, /SameSite=Strict/, 'without SameSite, navigation brings CSRF');
  assert.match(cab, /Secure/, 'outside development the session cannot travel in the clear');
});

test('the first access is created only once', async () => {
  const id = new IdentidadeSenha(new Pessoas(':memory:'), { seguro: false });
  assert.ok(await id.primeiroAcesso('dono@exemplo.org'));
  assert.equal(await id.primeiroAcesso('outro@exemplo.org'), null, 'it does not recreate when someone is already there');
});

test('the database REFUSES to alter and to delete an event', async () => {
  const caminho = '/tmp/teste-eventos.db';
  try {
    const r = new RegistroSqlite(caminho);
    await r.incluir({ tipo: 'aprovacao', pagina: 'A01', caixa: 'A01.1.1', digital: 'abc', texto: null, foto: null, dados: null }, 'ale@exemplo.org');
    r.fechar();
    // Open it from outside, the way anyone with access to the disk would.
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(caminho);
    assert.throws(() => db.exec('DELETE FROM events'), /trail/, 'deleting has to be refused');
    assert.throws(() => db.exec("UPDATE events SET author='outro@x'"), /trail/, 'altering has to be refused');
    assert.equal(db.prepare('SELECT COUNT(*) c FROM events').get().c, 1);
    db.close();
  } finally {
    for (const s of ['', '-wal', '-shm']) rmSync(caminho + s, { force: true });
  }
});

test('the sqlite store keeps and gives back the whole event', async () => {
  const r = new RegistroSqlite(':memory:');
  const e = await r.incluir({ tipo: 'pedido', pagina: 'A01', caixa: 'A01.1.1', digital: 'x',
    texto: 'swap the term', foto: 'the text as it was then', dados: { categoria: 'termo' } }, 'revisora@exemplo.org');
  const [lido] = await r.listar('A01');
  assert.deepEqual({ ...lido }, { ...e }, 'what comes out has to be what went in');
  assert.deepEqual(lido.dados, { categoria: 'termo' }, 'data comes back as an object, not as text');
  assert.equal((await r.listar('A02')).length, 0, 'the filter by page works');
});

/**
 * A migration you only get to run wrong once.
 *
 * Renaming the table that holds human approvals is not a rename — it is a move of the one thing in
 * this project that cannot be recreated. This test builds a database in the OLD shape, opens it
 * with today's code, and checks the events survived.
 */
test('a database written in Portuguese still opens, and nothing is lost', async () => {
  const caminho = `/tmp/teste-migracao-${process.pid}.db`;
  rmSync(caminho, { force: true });
  try {
    // the database as it was before 2026-09-20
    const velho = new DatabaseSync(caminho);
    velho.exec(`
      CREATE TABLE eventos (
        id TEXT PRIMARY KEY, tipo TEXT NOT NULL, pagina TEXT NOT NULL, caixa TEXT,
        digital TEXT, texto TEXT, foto TEXT, autor TEXT NOT NULL, quando TEXT NOT NULL, dados TEXT);
      INSERT INTO eventos VALUES
        ('e1','aprovacao','D01','D01.1.1','abc123','approved','the text as it was then',
         'dono@exemplo.org','2026-09-16T10:00:00Z','{"origem":"site"}');
    `);
    velho.close();

    // today
    const r = new RegistroSqlite(caminho);
    const eventos = await r.listar();
    assert.equal(eventos.length, 1, 'the approval has to survive the migration');
    const e = eventos[0];
    assert.equal(e.id, 'e1');
    assert.equal(e.tipo, 'aprovacao');
    assert.equal(e.caixa, 'D01.1.1');
    assert.equal(e.digital, 'abc123', 'the fingerprint is what makes the approval hold — it cannot be lost');
    assert.equal(e.autor, 'dono@exemplo.org');
    assert.equal(e.quando, '2026-09-16T10:00:00Z');
    assert.deepEqual(e.dados, { origem: 'site' });
    r.fechar();

    // and the old table is still there: copy, never move
    const db = new DatabaseSync(caminho);
    assert.equal(db.prepare('SELECT COUNT(*) c FROM eventos').get().c, 1,
      'the old table stays in the file, for checking');
    db.close();
  } finally {
    rmSync(caminho, { force: true });
    rmSync(`${caminho}-wal`, { force: true });
    rmSync(`${caminho}-shm`, { force: true });
  }
});
