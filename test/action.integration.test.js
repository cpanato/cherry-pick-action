import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, it } from 'node:test';

const execFileAsync = promisify(execFile);
const bundlePath = resolve('dist/index.cjs');

describe('bundled action', () => {
  it('cherry-picks commits and opens a pull request through the GitHub API', async t => {
    const requests = [];
    let createdCommit = 0;
    const server = createServer((request, response) => {
      const chunks = [];
      request.on('data', chunk => chunks.push(chunk));
      request.on('end', () => {
        const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
        const body = chunks.length > 0
          ? JSON.parse(Buffer.concat(chunks).toString())
          : undefined;
        requests.push({ method: request.method, path, body });

        const send = (statusCode, data) => {
          response.writeHead(statusCode, { 'content-type': 'application/json' });
          response.end(data === undefined ? '' : JSON.stringify(data));
        };

        if (request.method === 'GET' && path === '/repos/owner/repo/pulls/42') {
          return send(200, { number: 42, title: 'Source change' });
        }
        if (request.method === 'GET' && path === '/repos/owner/repo/pulls/42/commits') {
          return send(200, [{ sha: 'source-commit' }]);
        }
        if (request.method === 'GET' && path.endsWith('/git/ref/heads/stable')) {
          return send(200, { object: { sha: 'base-sha' } });
        }
        if (request.method === 'GET' && path.includes('/git/ref/heads/')) {
          return send(200, { object: { sha: 'base-sha' } });
        }
        if (request.method === 'GET' && path.endsWith('/git/commits/base-sha')) {
          return send(200, { tree: { sha: 'base-tree' } });
        }
        if (request.method === 'GET' && path.endsWith('/git/commits/source-commit')) {
          return send(200, {
            author: { name: 'Author', email: 'author@example.com', date: '2026-01-01T00:00:00Z' },
            committer: { name: 'Committer', email: 'committer@example.com', date: '2026-01-01T00:00:00Z' },
            message: 'Source commit',
            parents: [{ sha: 'source-parent' }]
          });
        }
        if (request.method === 'POST' && path.endsWith('/git/refs')) {
          return send(201, { ref: body.ref, object: { sha: body.sha } });
        }
        if (request.method === 'POST' && path.endsWith('/git/commits')) {
          createdCommit += 1;
          return send(201, { sha: `created-commit-${createdCommit}` });
        }
        if (request.method === 'POST' && path.endsWith('/merges')) {
          return send(201, { commit: { tree: { sha: 'merged-tree' } } });
        }
        if (request.method === 'PATCH' && path.includes('/git/refs/')) {
          return send(200, { object: { sha: body.sha } });
        }
        if (request.method === 'DELETE' && path.includes('/git/refs/')) {
          response.writeHead(204);
          return response.end();
        }
        if (request.method === 'POST' && path === '/repos/owner/repo/pulls') {
          return send(201, {
            number: 73,
            html_url: 'https://github.com/owner/repo/pull/73'
          });
        }

        send(404, { message: `Unexpected request: ${request.method} ${path}` });
      });
    });

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
        GITHUB_API_URL: `http://127.0.0.1:${address.port}`,
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_OUTPUT: outputPath,
        GITHUB_REPOSITORY: 'owner/repo',
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
