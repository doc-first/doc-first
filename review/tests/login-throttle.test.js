import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IdentidadeSenha } from '../api/identity-password.ts';
import { UsersSqlite } from '../api/users-sqlite.ts';

/**
 * Online brute force, and why the counter is per e-mail.
 *
 * While an identity proxy stood in front of this service, nobody reached the login form without
 * being let in first. Answering on the open internet with only a password changes that: the form
 * is found by a scanner within hours, and an unthrottled form is an invitation to try passwords
 * for as long as anyone feels like it.
 */
const store = () => new UsersSqlite(':memory:');

test('five wrong passwords cost nothing; the sixth starts costing', async () => {
  const id = new IdentidadeSenha(store(), { seguro: false });
  await id.primeiroAcesso('someone@example.org', 'Someone');

  for (let i = 0; i < 5; i++) assert.equal(await id.entrar('someone@example.org', 'wrong'), null);
  assert.equal(id.remainingWait('someone@example.org'), 0, 'five is still free');

  assert.equal(await id.entrar('someone@example.org', 'wrong'), null);
  assert.ok(id.remainingWait('someone@example.org') > 0, 'the sixth buys a wait');
});

test('while the wait is on, even the RIGHT password does not get in', async () => {
  // The part that makes it worth anything. A throttle that lets the right password through on the
  // first try after the lock is a throttle an attacker walks past.
  const users = store();
  const id = new IdentidadeSenha(users, { seguro: false });
  const right = await id.primeiroAcesso('someone@example.org', 'Someone');

  for (let i = 0; i < 6; i++) await id.entrar('someone@example.org', 'wrong');
  assert.ok(id.remainingWait('someone@example.org') > 0);
  assert.equal(await id.entrar('someone@example.org', right), null, 'locked means locked');
});

test('the wait grows, instead of being a fixed pause', async () => {
  const id = new IdentidadeSenha(store(), { seguro: false });
  await id.primeiroAcesso('someone@example.org', 'Someone');

  for (let i = 0; i < 6; i++) await id.entrar('someone@example.org', 'wrong');
  const first = id.remainingWait('someone@example.org');
  for (let i = 0; i < 3; i++) await id.entrar('someone@example.org', 'wrong');
  assert.ok(id.remainingWait('someone@example.org') > first, 'each failure costs more than the last');
});

test('one e-mail being locked never locks another', async () => {
  // Counting per IP instead would let one person lock out a whole office behind one proxy.
  const users = store();
  const id = new IdentidadeSenha(users, { seguro: false });
  await id.primeiroAcesso('someone@example.org', 'Someone');
  const other = await users.create('other@example.org', 'Other');

  for (let i = 0; i < 8; i++) await id.entrar('someone@example.org', 'wrong');
  assert.ok(id.remainingWait('someone@example.org') > 0);
  assert.equal(id.remainingWait('other@example.org'), 0);
  assert.ok(await id.entrar('other@example.org', other), 'the neighbour still gets in');
});

test('a successful login clears the count', async () => {
  const id = new IdentidadeSenha(store(), { seguro: false });
  const right = await id.primeiroAcesso('someone@example.org', 'Someone');

  for (let i = 0; i < 4; i++) await id.entrar('someone@example.org', 'wrong');
  assert.ok(await id.entrar('someone@example.org', right));
  for (let i = 0; i < 5; i++) assert.equal(await id.entrar('someone@example.org', 'wrong'), null);
  assert.equal(id.remainingWait('someone@example.org'), 0, 'the count restarted from zero');
});
