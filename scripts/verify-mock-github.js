import assert from 'node:assert/strict';

const response = await fetch(`${process.env.MOCK_GITHUB_API_URL}/requests`);
assert.ok(response.ok, `Mock API returned ${response.status}`);
const requests = await response.json();
const { BRANCH_NAME, PULL_REQUEST_NUMBER, PULL_REQUEST_URL, GITHUB_REPOSITORY } = process.env;
const prefix = `/repos/${GITHUB_REPOSITORY}`;

assert.match(BRANCH_NAME, /^cherry-pick-42-\d+-[a-f0-9]{8}$/);
assert.equal(PULL_REQUEST_NUMBER, '73');
assert.equal(PULL_REQUEST_URL, `https://github.com/${GITHUB_REPOSITORY}/pull/73`);
assert.ok(requests.some(r => r.method === 'POST' && r.path === `${prefix}/merges`));
assert.ok(requests.some(r => r.method === 'POST' && r.path === `${prefix}/pulls` &&
  r.body.head === BRANCH_NAME && r.body.base === 'stable'));
assert.ok(requests.some(r => r.method === 'DELETE' &&
  r.path.startsWith(`${prefix}/git/refs/heads/cherry-pick-${BRANCH_NAME}-`)));
