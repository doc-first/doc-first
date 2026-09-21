/**
 * Own authentication and storage with no cloud — what lets Doc First be used the way Keycloak is:
 * bring it up, log in, work.
 *
 * Behaviour every store has to share is NOT here: it lives in users-conformance.test.js, which
 * runs one suite against all of them. What stays here is what is specific — the bytes SQLite
 * writes to disk, the migration of a database written in Portuguese, and the cookie the identity
 * layer hands out.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { UsersSqlite } from '../api/users-sqlite.ts';
import { ephemeralUserStoreWarning, looksEphemeral, isEmailAddress } from '../api/users.ts';
import { IdentidadeSenha } from '../api/identity-password.ts';
import { RegistroSqlite } from '../api/store-sqlite.ts';

test('the password is never stored as text', async () => {
  const p = new UsersSqlite('/tmp/teste-pessoas.db');
  try {
    const password = await p.create('x@example.org', 'X', 'secret-test-password');
    await p.close();
    // Read the raw file: the password cannot be anywhere in it.
    const { readFileSync } = await import('node:fs');
    const raw = readFileSync('/tmp/teste-pessoas.db').toString('latin1');
    assert.equal(raw.includes('secret-test-password'), false, 'the password showed up in the database file');
    assert.ok(password);
  } finally {
    rmSync('/tmp/teste-pessoas.db', { force: true });
    rmSync('/tmp/teste-pessoas.db-wal', { force: true });
    rmSync('/tmp/teste-pessoas.db-shm', { force: true });
  }
});

test('session: it opens, it holds, and it stops holding on logout', async () => {
  const p = new UsersSqlite(':memory:');
  const password = await p.create('x@example.org', 'X');
  const id = new IdentidadeSenha(p, { seguro: false });
  const r = await id.entrar('x@example.org', password);
  assert.ok(r);
  assert.equal((await id.daRequisicao({ cookie: `docfirst_sessao=${r.sessao}` }))?.email, 'x@example.org');
  assert.equal(await id.daRequisicao({ cookie: 'docfirst_sessao=made-up' }), null);
  assert.equal(await id.daRequisicao({}), null);
  await p.closeSession(r.sessao);
  assert.equal(await id.daRequisicao({ cookie: `docfirst_sessao=${r.sessao}` }), null, 'a closed session is worth nothing');
});

test('the session cookie is not readable by JavaScript and does not travel to another site', () => {
  const id = new IdentidadeSenha(new UsersSqlite(':memory:'), { seguro: true });
  const cab = id.cabecalhoDeSessao('abc');
  assert.match(cab, /HttpOnly/, 'without HttpOnly, an XSS steals the session');
  assert.match(cab, /SameSite=Strict/, 'without SameSite, navigation brings CSRF');
  assert.match(cab, /Secure/, 'outside development the session cannot travel in the clear');
});

test('the first access is created only once', async () => {
  const id = new IdentidadeSenha(new UsersSqlite(':memory:'), { seguro: false });
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

/**
 * The other migration that only gets one chance.
 *
 * Before 2026-09-20 people lived in `pessoas`, with Portuguese columns. Losing that table is not
 * losing a cache: it is everyone locked out of their own documentation, with no way back, because
 * a password hash cannot be reconstructed from anything.
 *
 * The old database is built HERE by writing with today's code and then renaming the table back,
 * rather than by hashing a password inside the test. A test that reimplemented scrypt would keep
 * passing on the day production changed its parameters — which is exactly the day it should shout.
 */
test('a user database written in Portuguese still opens, and the password still works', async () => {
  const path = `/tmp/teste-usuarios-migracao-${process.pid}.db`;
  for (const suffix of ['', '-wal', '-shm']) rmSync(path + suffix, { force: true });
  try {
    const before = new UsersSqlite(path);
    await before.create('owner@example.org', 'Owner', 'a-long-enough-password');
    await before.close();

    // put the file back in the shape it had before the rename
    const raw = new DatabaseSync(path);
    raw.exec(`
      CREATE TABLE pessoas (
        email TEXT PRIMARY KEY, nome TEXT NOT NULL, sal BLOB NOT NULL, hash BLOB NOT NULL,
        trocar INTEGER NOT NULL DEFAULT 0, criada_em TEXT NOT NULL);
      INSERT INTO pessoas SELECT email, name, salt, hash, must_change, created_at FROM users;
      DROP TABLE sessions;
      DROP TABLE users;
    `);
    raw.close();

    const after = new UsersSqlite(path);
    const person = await after.check('owner@example.org', 'a-long-enough-password');
    assert.ok(person, 'the password has to keep working: it cannot be reconstructed');
    assert.equal(person.name, 'Owner');
    assert.equal(person.mustChangePassword, true, 'the first-access flag travels too');
    assert.equal(person.enabled, true,
      'a table written before anybody could be disabled has nobody disabled in it');
    assert.ok(await after.openSession('owner@example.org'), 'sessions work again after the move');
    await after.close();

    // copy, never move: the old table stays in the file for whoever wants to check it
    const checking = new DatabaseSync(path);
    assert.equal(checking.prepare('SELECT COUNT(*) c FROM pessoas').get().c, 1);
    checking.close();
  } finally {
    for (const suffix of ['', '-wal', '-shm']) rmSync(path + suffix, { force: true });
  }
});

/**
 * The upgrade that would have locked a whole team out of their own tool.
 *
 * `CREATE TABLE IF NOT EXISTS` does NOTHING to a table that is already there, so a file written
 * before the `enabled` column existed would keep its six columns, every read would come back with
 * `enabled` undefined — falsy — and everybody would be refused at the door on the first restart
 * after the upgrade. They would see "e-mail or password do not match" holding the right password,
 * with nothing in the log to explain it. `ALTER TABLE ... DEFAULT 1` is what prevents that, and
 * this test is the only thing that says so out loud.
 */
test('a database written before anyone could be disabled keeps letting everyone in', async () => {
  const path = `/tmp/teste-usuarios-enabled-${process.pid}.db`;
  for (const suffix of ['', '-wal', '-shm']) rmSync(path + suffix, { force: true });
  try {
    const before = new UsersSqlite(path);
    await before.create('old@example.org', 'Was Here Already', 'a-long-enough-password');
    await before.close();

    // Put the file back in the shape the previous release wrote: the same row, no `enabled`
    // column anywhere. The credential has to survive the rewrite or the test proves nothing.
    const raw = new DatabaseSync(path);
    raw.exec(`
      CREATE TABLE old_users (
        email TEXT PRIMARY KEY, name TEXT NOT NULL, salt BLOB NOT NULL, hash BLOB NOT NULL,
        must_change INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
      INSERT INTO old_users SELECT email, name, salt, hash, must_change, created_at FROM users;
      DROP TABLE users;
      ALTER TABLE old_users RENAME TO users;
    `);
    assert.ok(
      !raw.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'enabled'),
      'the starting point has to be a file without the column, or this proves nothing');
    raw.close();

    const upgraded = new UsersSqlite(path);
    const columns = new DatabaseSync(path).prepare('PRAGMA table_info(users)').all();
    assert.ok(columns.some((c) => c.name === 'enabled'), 'the column has to be added, not assumed');

    assert.ok(await upgraded.check('old@example.org', 'a-long-enough-password'),
      'somebody who could sign in yesterday signs in today: an upgrade is not a revocation');
    assert.equal((await upgraded.find('old@example.org')).enabled, true);
    await upgraded.close();
  } finally {
    for (const suffix of ['', '-wal', '-shm']) rmSync(path + suffix, { force: true });
  }
});

/**
 * The combination that loses people: a file, on a disk that does not survive the instance.
 *
 * The false positive is tested as hard as the true one. A warning that fires on a laptop, where a
 * file is the right answer, is a warning everybody learns to scroll past — and then it says
 * nothing on the day it is true.
 */
test('it warns when people are kept in a file on a runtime that looks ephemeral', () => {
  const warning = ephemeralUserStoreWarning('sqlite:/data/users.db', { K_SERVICE: 'doc-first' });
  assert.ok(warning, 'a file plus an ephemeral runtime is exactly the case that has to be announced');
  assert.match(warning, /recycles/, 'it has to say what will happen, not only that something is wrong');
  assert.match(warning, /REVISAO_USERS=firestore/, 'it has to say what to do instead');
  assert.match(warning, /postgres/, 'the other way out belongs in the same line');
});

test('the default store warns too: not configuring it is how people get there', () => {
  assert.ok(ephemeralUserStoreWarning(undefined, { K_SERVICE: 'doc-first' }));
  assert.ok(ephemeralUserStoreWarning('sqlite', { K_SERVICE: 'doc-first' }));
});

test('it stays quiet when nothing is at stake', () => {
  const ephemeral = { K_SERVICE: 'doc-first' };
  assert.equal(ephemeralUserStoreWarning('sqlite::memory:', ephemeral), null, 'memory is already understood to be thrown away');
  assert.equal(ephemeralUserStoreWarning('sqlite://:memory:', ephemeral), null, 'the // form names the same store');
  assert.equal(ephemeralUserStoreWarning('firestore', ephemeral), null, 'firestore survives the instance');
  assert.equal(ephemeralUserStoreWarning('postgres://u:p@host/db', ephemeral), null, 'and so does postgres');
  assert.equal(ephemeralUserStoreWarning('sqlite:/data/users.db', {}), null, 'on a laptop a file is the right answer');
});

test('K_SERVICE is a signal, and an empty one is no signal at all', () => {
  assert.equal(looksEphemeral({}), false);
  assert.equal(looksEphemeral({ K_SERVICE: '' }), false, 'an empty variable is evidence of nothing');
  assert.equal(looksEphemeral({ K_SERVICE: 'doc-first' }), true);
});

/**
 * The check on the way in is deliberately shallow, and these are the cases it has to get right.
 *
 * It exists for one failure: somebody types a NAME into the e-mail box, an access is created that
 * nobody can ever sign in to, and it cannot be taken back afterwards because nothing here is
 * deleted. What it must NOT do is turn into an RFC 5322 parser — those are famous for rejecting
 * addresses that work, and a door that refuses a real person is worse than one that admits a typo.
 */
test('an address is told apart from a name, without pretending to parse RFC 5322', () => {
  assert.equal(isEmailAddress('someone@example.org'), true);
  assert.equal(isEmailAddress('  Someone@Example.ORG  '), true, 'it is checked after trimming');
  assert.equal(isEmailAddress('root@localhost'), true,
    'no dot is demanded: single-label hosts are real, and this is not the place to decide what '
    + "somebody else's network looks like");
  assert.equal(isEmailAddress('first+tag@example.co.uk'), true);

  assert.equal(isEmailAddress(''), false, 'an empty field is the commonest way to get here');
  assert.equal(isEmailAddress('   '), false);
  assert.equal(isEmailAddress('A Member'), false, 'the name typed into the e-mail box');
  assert.equal(isEmailAddress('@example.org'), false, 'nothing before the @');
  assert.equal(isEmailAddress('someone@'), false, 'nothing after it');
  assert.equal(isEmailAddress('a@b@c'), false, 'two of them is not an address');
  assert.equal(isEmailAddress('a'.repeat(320) + '@example.org'), false,
    'past the longest address RFC 5321 allows it is not a typo, it is a payload');
});
