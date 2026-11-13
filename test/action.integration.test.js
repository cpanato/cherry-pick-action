import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, it } from 'node:test';
import { createMockGitHubServer } from '../scripts/mock-github.js';

const execFileAsync = promisify(execFile);
const bundlePath = resolve('dist/index.cjs');

describe('bundled action', () => {
  it('cherry-picks commits and opens a pull request through the GitHub API', async t => {
    const { server, requests } = createMockGitHubServer();

    await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
    const address = server.address();
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'cherry-pick-action-'));
    const eventPath = join(temporaryDirectory, 'event.json');
    const outputPath = join(temporaryDirectory, 'output.txt');

    t.after(async () => {
      await new Promise((resolveClose, rejectClose) => {
        server.close(error => error ? rejectClose(error) : resolveClose());
      });
      await rm(temporaryDirectory, { recursive: true, force: true });
    });

    await writeFile(eventPath, JSON.stringify({ pull_request: { number: 42 } }));
    await writeFile(outputPath, '');
    await execFileAsync(process.execPath, [bundlePath], {
      env: {
        ...process.env,
        GITHUB_ACTIONS: 'true',
        GITHUB_API_URL: 'https://api.github.com',
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_OUTPUT: outputPath,
        GITHUB_REPOSITORY: 'owner/repo',
        MOCK_GITHUB_API_URL: `http://127.0.0.1:${address.port}`,
        NODE_OPTIONS: `--require=${JSON.stringify(resolve('scripts/mock-github-preload.cjs'))}`,
        INPUT_TOKEN: 'test-token',
        INPUT_PULL_NUMBER: '42',
        INPUT_TO_BRANCH: 'stable'
      },
      timeout: 15000
    });

    const outputs = await readFile(outputPath, 'utf8');
    const getOutput = name => {
      const match = outputs.match(
        new RegExp(`^${name}<<([^\\r\\n]+)\\r?\\n([\\s\\S]*?)\\r?\\n\\1\\r?$`, 'm')
      );
      assert.ok(match, `Missing ${name} output: ${outputs}`);
      return match[2];
    };
    const branchName = getOutput('branch_name');
    assert.match(branchName, /^cherry-pick-42-\d+-[a-f0-9]{8}$/);
    assert.equal(getOutput('pull_request_number'), '73');
    assert.equal(
      getOutput('pull_request_url'),
      'https://github.com/owner/repo/pull/73'
    );

    await execFileAsync(process.execPath, [resolve('scripts/verify-mock-github.js')], {
      env: {
        ...process.env,
        BRANCH_NAME: branchName,
        PULL_REQUEST_NUMBER: getOutput('pull_request_number'),
        PULL_REQUEST_URL: getOutput('pull_request_url'),
        GITHUB_REPOSITORY: 'owner/repo',
        MOCK_GITHUB_API_URL: `http://127.0.0.1:${address.port}`
      },
      timeout: 15000
    });

    assert.ok(requests.some(({ method, path }) =>
      method === 'POST' && path === '/repos/owner/repo/merges'));
    assert.ok(requests.some(({ method, path, body }) =>
      method === 'POST' &&
      path === '/repos/owner/repo/pulls' &&
      body.head === branchName &&
      body.base === 'stable'));
    assert.ok(requests.some(({ method, path }) =>
      method === 'DELETE' &&
      path.includes('/git/refs/heads/cherry-pick-cherry-pick-42-')));
  });
});
