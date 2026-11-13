import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getPullCommitShas,
  parsePullNumber,
  runAction,
  validateBranchName
} from '../lib/action.js';

describe('input validation', () => {
  it('accepts only positive safe pull request numbers', () => {
    assert.equal(parsePullNumber('42'), 42);
    for (const value of ['0', '-1', '1.5', '12abc', '9007199254740992', '']) {
      assert.throws(() => parsePullNumber(value), /pull_number/);
    }
  });

  it('accepts branch names and rejects invalid or fully qualified refs', () => {
    assert.doesNotThrow(() => validateBranchName('release/2.x'));
    for (const branch of ['', ' refs/main', 'refs/heads/main', 'main..next', 'bad name', 'branch/']) {
      assert.throws(() => validateBranchName(branch), /to_branch/);
    }
  });
});

describe('getPullCommitShas', () => {
  it('uses Octokit pagination and preserves the returned commit order', async () => {
    const commits = Array.from({ length: 35 }, (_, index) => ({ sha: `sha-${index}` }));
    const listCommits = () => {};
    let paginateCall;
    const client = {
      rest: { pulls: { listCommits } },
      paginate: async (...args) => {
        paginateCall = args;
        return commits;
      }
    };

    const result = await getPullCommitShas(
      client,
      { repo: { owner: 'owner', repo: 'repo' } },
      42
    );

    assert.deepEqual(result, commits.map(commit => commit.sha));
    assert.equal(paginateCall[0], listCommits);
    assert.deepEqual(paginateCall[1], {
      owner: 'owner',
      repo: 'repo',
      pull_number: 42,
      per_page: 100
    });
  });
});

function createHarness({ commits = [{ sha: 'commit-1' }], cherryPickError } = {}) {
  const calls = [];
  const outputs = {};
  const failures = [];
  const warnings = [];
  const inputs = {
    token: 'test-token',
    pull_number: '42',
    to_branch: 'stable'
  };
  const context = { repo: { owner: 'owner', repo: 'repo' } };
  const pullRequest = {
    number: 73,
    html_url: 'https://github.com/owner/repo/pull/73'
  };
  const client = {
    rest: {
      pulls: {
        get: async parameters => {
          calls.push(['getPull', parameters]);
          return { data: { title: 'Source change' } };
        },
        listCommits: () => {},
        create: async parameters => {
          calls.push(['createPull', parameters]);
          return { data: pullRequest };
        }
      },
      git: {
        getRef: async parameters => {
          calls.push(['getRef', parameters]);
          return { data: { object: { sha: 'base-sha' } } };
        },
        createRef: async parameters => {
          calls.push(['createRef', parameters]);
          return { data: {} };
        },
        deleteRef: async parameters => {
          calls.push(['deleteRef', parameters]);
        }
      }
    },
    paginate: async () => commits
  };
  const core = {
    getInput: name => inputs[name],
    setOutput: (name, value) => {
      outputs[name] = value;
    },
    info: () => {},
    warning: message => warnings.push(message),
    error: () => {},
    setFailed: message => failures.push(message)
  };
  const github = {
    context,
    getOctokit: token => {
      assert.equal(token, 'test-token');
      return client;
    }
  };
  const cherryPickCommits = async parameters => {
    calls.push(['cherryPick', parameters]);
    if (cherryPickError) {
      throw cherryPickError;
    }
    return 'head-sha';
  };

  return {
    calls,
    core,
    failures,
    github,
    inputs,
    outputs,
    warnings,
    cherryPickCommits
  };
}

describe('runAction', () => {
  it('creates a pull request and exposes its outputs', async () => {
    const harness = createHarness();

    await runAction({
      core: harness.core,
      github: harness.github,
      cherryPickCommits: harness.cherryPickCommits,
      makeBranchName: () => 'cherry-pick-42-test'
    });

    assert.deepEqual(harness.outputs, {
      branch_name: 'cherry-pick-42-test',
      pull_request_number: '73',
      pull_request_url: 'https://github.com/owner/repo/pull/73'
    });
    assert.deepEqual(harness.failures, []);
    assert.deepEqual(
      harness.calls.find(([name]) => name === 'cherryPick')[1].commits,
      ['commit-1']
    );
    assert.deepEqual(harness.calls.find(([name]) => name === 'createPull')[1], {
      owner: 'owner',
      repo: 'repo',
      base: 'stable',
      head: 'cherry-pick-42-test',
      title: '[CherryPick] Source change',
      body: 'Cherry pick of #42'
    });
  });

  it('deletes the created branch when cherry-picking fails', async () => {
    const harness = createHarness({ cherryPickError: new Error('conflict') });

    await runAction({
      core: harness.core,
      github: harness.github,
      cherryPickCommits: harness.cherryPickCommits,
      makeBranchName: () => 'cherry-pick-42-test'
    });

    assert.deepEqual(harness.calls.find(([name]) => name === 'deleteRef'), [
      'deleteRef',
      { owner: 'owner', repo: 'repo', ref: 'heads/cherry-pick-42-test' }
    ]);
    assert.deepEqual(harness.failures, ['conflict']);
  });

  it('does not create a branch when the pull request has no commits', async () => {
    const harness = createHarness({ commits: [] });

    await runAction({
      core: harness.core,
      github: harness.github,
      cherryPickCommits: harness.cherryPickCommits,
      makeBranchName: () => 'cherry-pick-42-test'
    });

    assert.equal(harness.calls.some(([name]) => name === 'createRef'), false);
    assert.match(harness.failures[0], /does not contain any commits/);
  });

  it('fails before creating an Octokit client for an invalid pull number', async () => {
    const harness = createHarness();
    harness.inputs.pull_number = '42oops';

    await runAction({
      core: harness.core,
      github: harness.github,
      cherryPickCommits: harness.cherryPickCommits
    });

    assert.deepEqual(harness.failures, ['pull_number must be a positive integer.']);
    assert.equal(harness.calls.length, 0);
  });
});
