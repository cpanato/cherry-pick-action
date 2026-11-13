import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cherryPickCommits } from '../lib/cherry-pick.js';

function harness({ mergeError, deleteError, parents = [{ sha: 'source-parent' }], noChange = false } = {}) {
  const calls = [];
  const warnings = [];
  let count = 0;
  const git = {
    getRef: async args => {
      calls.push(['getRef', args]);
      return { data: { object: { sha: 'base-sha' } } };
    },
    getCommit: async args => {
      calls.push(['getCommit', args]);
      if (args.commit_sha === 'base-sha') return { data: { tree: { sha: 'base-tree' } } };
      return { data: { author: { name: 'Author' }, committer: { name: 'Committer' }, message: args.commit_sha, parents } };
    },
    createRef: async args => calls.push(['createRef', args]),
    createCommit: async args => {
      calls.push(['createCommit', args]);
      return { data: { sha: `created-${++count}` } };
    },
    updateRef: async args => calls.push(['updateRef', args]),
    deleteRef: async args => {
      calls.push(['deleteRef', args]);
      if (deleteError) throw deleteError;
    }
  };
  const octokit = {
    git,
    repos: { merge: async args => {
      calls.push(['merge', args]);
      if (mergeError) throw mergeError;
      return noChange ? { status: 204 } : { status: 201, data: { commit: { tree: { sha: `merged-${count}` } } } };
    } }
  };
  return {
    calls,
    warnings,
    options: { owner: 'owner', repo: 'repo', octokit, head: 'target', commits: ['one', 'two'], warn: message => warnings.push(message) }
  };
}

describe('cherryPickCommits', () => {
  it('applies commits in order and updates the destination only after all succeed', async () => {
    const { calls, options } = harness();
    assert.equal(await cherryPickCommits(options), 'created-4');
    const created = calls.filter(([name]) => name === 'createCommit').map(([, args]) => args);
    assert.deepEqual(created.map(({ parents, tree }) => ({ parents, tree })), [
      { parents: ['source-parent'], tree: 'base-tree' },
      { parents: ['base-sha'], tree: 'merged-1' },
      { parents: ['source-parent'], tree: 'merged-1' },
      { parents: ['created-2'], tree: 'merged-3' }
    ]);
    assert.deepEqual(created.filter(({ message }) => message === 'one' || message === 'two').map(({ message }) => message), ['one', 'two']);
    const updates = calls.filter(([name]) => name === 'updateRef').map(([, args]) => args);
    assert.deepEqual(updates.at(-1), { owner: 'owner', repo: 'repo', ref: 'heads/target', sha: 'created-4', force: false });
    const tempRef = calls.find(([name]) => name === 'createRef')[1].ref;
    assert.equal(calls.at(-1)[1].ref, tempRef.replace('refs/', ''));
  });

  it('uses the existing tree for an already-up-to-date merge', async () => {
    const { calls, options } = harness({ noChange: true });
    options.commits = ['one'];
    await cherryPickCommits(options);
    assert.equal(calls.filter(([name]) => name === 'createCommit')[1][1].tree, 'base-tree');
  });

  it('cleans up after a conflict without updating the destination', async () => {
    const { calls, options } = harness({ mergeError: new Error('conflict') });
    await assert.rejects(cherryPickCommits(options), /conflict/);
    assert.equal(calls.some(([name, args]) => name === 'updateRef' && args.ref === 'heads/target'), false);
    assert.equal(calls.at(-1)[0], 'deleteRef');
  });

  it('rejects merge commits and preserves the original error if cleanup fails', async () => {
    const { calls, options, warnings } = harness({
      parents: [{ sha: 'a' }, { sha: 'b' }],
      deleteError: new Error('cleanup failed')
    });
    await assert.rejects(cherryPickCommits(options), /2 parents/);
    assert.equal(calls.some(([name]) => name === 'merge'), false);
    assert.match(warnings[0], /cleanup failed/);
  });
});
