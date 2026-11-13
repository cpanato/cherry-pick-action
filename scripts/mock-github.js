import { createServer } from 'node:http';

export function createMockGitHubServer(repository = 'owner/repo') {
  const requests = [];
  let createdCommit = 0;
  const prefix = `/repos/${repository}`;

  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const body = chunks.length > 0
        ? JSON.parse(Buffer.concat(chunks).toString())
        : undefined;

      const send = (statusCode, data) => {
        response.writeHead(statusCode, { 'content-type': 'application/json' });
        response.end(data === undefined ? '' : JSON.stringify(data));
      };

      if (request.method === 'GET' && path === '/health') {
        return send(200, { ok: true });
      }
      if (request.method === 'GET' && path === '/requests') {
        return send(200, requests);
      }

      requests.push({ method: request.method, path, body });

      if (request.method === 'GET' && path === `${prefix}/pulls/42`) {
        return send(200, { number: 42, title: 'Source change' });
      }
      if (request.method === 'GET' && path === `${prefix}/pulls/42/commits`) {
        return send(200, [{ sha: 'source-commit' }]);
      }
      if (request.method === 'GET' && path.startsWith(`${prefix}/git/ref/heads/`)) {
        return send(200, { object: { sha: 'base-sha' } });
      }
      if (request.method === 'GET' && path === `${prefix}/git/commits/base-sha`) {
        return send(200, { tree: { sha: 'base-tree' } });
      }
      if (request.method === 'GET' && path === `${prefix}/git/commits/source-commit`) {
        return send(200, {
          author: { name: 'Author', email: 'author@example.com', date: '2026-01-01T00:00:00Z' },
          committer: { name: 'Committer', email: 'committer@example.com', date: '2026-01-01T00:00:00Z' },
          message: 'Source commit',
          parents: [{ sha: 'source-parent' }]
        });
      }
      if (request.method === 'POST' && path === `${prefix}/git/refs`) {
        return send(201, { ref: body.ref, object: { sha: body.sha } });
      }
      if (request.method === 'POST' && path === `${prefix}/git/commits`) {
        createdCommit += 1;
        return send(201, { sha: `created-commit-${createdCommit}` });
      }
      if (request.method === 'POST' && path === `${prefix}/merges`) {
        return send(201, { commit: { tree: { sha: 'merged-tree' } } });
      }
      if (request.method === 'PATCH' && path.startsWith(`${prefix}/git/refs/`)) {
        return send(200, { object: { sha: body.sha } });
      }
      if (request.method === 'DELETE' && path.startsWith(`${prefix}/git/refs/`)) {
        response.writeHead(204);
        return response.end();
      }
      if (request.method === 'POST' && path === `${prefix}/pulls`) {
        return send(201, {
          number: 73,
          html_url: `https://github.com/${repository}/pull/73`
        });
      }

      send(404, { message: `Unexpected request: ${request.method} ${path}` });
    });
  });

  return { server, requests };
}
