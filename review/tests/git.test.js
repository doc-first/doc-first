/**
 * The index has to know WHICH COMMIT it was built at, and it has to survive content that is not in
 * a repository at all.
 *
 * The second half is the one worth a test. It is easy to write a helper that works on the machine
 * of the person who wrote it — where everything is a checkout — and that throws for the first
 * person who points the tool at a plain folder of HTML. An index with no commit is less useful; an
 * index that refuses to be built is a broken tool.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { currentCommit } from '../core/git.js';

/**
 * A temporary directory that git will not consider part of any repository above it.
 *
 * ⚠️ GIT_CEILING_DIRECTORIES is what makes the negative test honest. Without it the answer would
 * depend on whether the machine happens to have a repository somewhere above the temporary
 * directory — the test would pass here and fail on somebody else's laptop for a reason that has
 * nothing to do with the code.
 */
const loneDirectory = () => {
  const parent = realpathSync(tmpdir());
  process.env.GIT_CEILING_DIRECTORIES = parent;
  return mkdtempSync(join(parent, 'doc-first-git-'));
};

/**
 * A repository built from nothing, for the test to look at.
 *
 * ⚠️ The configuration of the machine is cut out, not inherited. A developer with commit signing
 * on, a template directory or a hooks path would otherwise fail this test for reasons that have
 * nothing to do with the code being tested — and the failure would read as if the helper were
 * broken.
 */
const run = (dir, ...args) => {
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
  // ⚠️ GIT_DIR out of the way before anything writes. These tests run inside the pre-commit hook,
  // where git exports it — and `git init` with GIT_DIR set does not create a repository in `dir`,
  // it reinitialises the one the hook is committing to.
  for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE',
    'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_PREFIX']) {
    delete env[name];
  }
  return execFileSync('git', ['-C', dir, '-c', 'user.email=test@example.org', '-c', 'user.name=Test',
    '-c', 'commit.gpgsign=false', '-c', 'init.templateDir=', '-c', 'core.hooksPath=', ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env,
  }).trim();
};

test('the commit is the one git itself reports for HEAD', () => {
  const dir = loneDirectory();
  run(dir, 'init', '-q');
  writeFileSync(join(dir, 'D01.html'), '<p>content</p>');
  run(dir, 'add', 'D01.html');
  run(dir, 'commit', '-q', '-m', 'first');

  // Compared against a DIFFERENT git command, not against the one the helper runs: asserting that
  // `rev-parse` equals `rev-parse` would prove nothing but that the test calls the same code.
  assert.equal(currentCommit(dir), run(dir, 'log', '-1', '--format=%H'));
  assert.match(currentCommit(dir), /^[0-9a-f]{40}$/);
});

test('a folder that is not a git repository answers null, and nothing throws', () => {
  const dir = loneDirectory();
  writeFileSync(join(dir, 'D01.html'), '<p>content</p>');

  // The whole point: somebody keeping documentation in a plain folder still gets an index.
  assert.equal(currentCommit(dir), null);
});

test('a repository with no commit yet answers null too', () => {
  const dir = loneDirectory();
  run(dir, 'init', '-q');

  // A fresh `git init` has a HEAD that points nowhere. Different cause, same honest answer: there
  // is no commit to name, so there is nothing for a later diff to start from.
  assert.equal(currentCommit(dir), null);
});

test('a path that does not exist answers null instead of crashing the index', () => {
  assert.equal(currentCommit(join(realpathSync(tmpdir()), 'doc-first-no-such-directory-92831')), null);
});

test('a repository inherited from the environment does not answer for the content', () => {
  const repository = loneDirectory();
  run(repository, 'init', '-q');
  writeFileSync(join(repository, 'D01.html'), '<p>content</p>');
  run(repository, 'add', 'D01.html');
  run(repository, 'commit', '-q', '-m', 'first');
  const plainFolder = loneDirectory();

  // This is what running the tool from inside a git hook looks like: GIT_DIR is exported, and git
  // then answers about THAT repository no matter which directory it was pointed at. A commit from
  // somewhere else is worse than no commit — a later diff would compare the content against a tree
  // it has nothing to do with, and decide that hardly anything needs reparsing.
  const before = process.env.GIT_DIR;
  process.env.GIT_DIR = join(repository, '.git');
  try {
    assert.equal(currentCommit(plainFolder), null);
    assert.equal(currentCommit(repository), run(repository, 'log', '-1', '--format=%H'));
  } finally {
    if (before === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = before;
  }
});
