import { randomBytes } from 'node:crypto';

function parsePullNumber(value) {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error('pull_number must be a positive integer.');
  }

  const pullNumber = Number(value);
  if (!Number.isSafeInteger(pullNumber)) {
    throw new Error('pull_number must be a positive safe integer.');
  }

  return pullNumber;
}

function validateBranchName(branch) {
  const invalidRef = /[\x00-\x20\x7f~^:?*\\[]/;
  const ref = `refs/heads/${branch}`;

  if (
    typeof branch !== 'string' ||
    branch.length === 0 ||
    branch !== branch.trim() ||
    branch.startsWith('refs/heads/') ||
    branch === '@' ||
    ref.includes('//') ||
    ref.includes('..') ||
    ref.includes('@{') ||
    ref.endsWith('/') ||
    ref.endsWith('.') ||
    invalidRef.test(ref) ||
    ref.split('/').some(part => part.startsWith('.') || part.endsWith('.lock'))
  ) {
    throw new Error('to_branch must be a valid branch name, not a fully qualified ref.');
  }
}

async function getPull(client, context, pullNumber) {
  const response = await client.rest.pulls.get({
    ...context.repo,
    pull_number: pullNumber
  });
  return response.data;
}

async function getPullCommitShas(client, context, pullNumber) {
  const commits = await client.paginate(client.rest.pulls.listCommits, {
    ...context.repo,
    pull_number: pullNumber,
    per_page: 100
  });
  return commits.map(commit => commit.sha);
}

async function getRef(client, context, ref) {
  const response = await client.rest.git.getRef({
    ...context.repo,
    ref
  });
  return response.data;
}

async function runAction({
  core,
  github,
  cherryPickCommits,
  makeBranchName = pullNumber =>
    `cherry-pick-${pullNumber}-${Date.now()}-${randomBytes(4).toString('hex')}`
}) {
  let client;
  let context;
  let branchName;
  let branchCreated = false;
  let pullRequestCreated = false;

  try {
    const token = core.getInput('token', { required: true });
    const pullNumber = parsePullNumber(core.getInput('pull_number', { required: true }));
    const toBranch = core.getInput('to_branch', { required: true });
    validateBranchName(toBranch);

    context = github.context;
    client = github.getOctokit(token);

    const pull = await getPull(client, context, pullNumber);
    const commits = await getPullCommitShas(client, context, pullNumber);
    if (commits.length === 0) {
      throw new Error(`Pull request #${pullNumber} does not contain any commits.`);
    }

    const baseBranchRef = await getRef(client, context, `heads/${toBranch}`);
    branchName = makeBranchName(pullNumber);
    await client.rest.git.createRef({
      ...context.repo,
      ref: `refs/heads/${branchName}`,
      sha: baseBranchRef.object.sha
    });
    branchCreated = true;

    const headSha = await cherryPickCommits({
      ...context.repo,
      octokit: client.rest,
      head: branchName,
      commits
    });

    const pullRequest = (await client.rest.pulls.create({
      ...context.repo,
      base: toBranch,
      head: branchName,
      title: `[CherryPick] ${pull.title}`,
      body: `Cherry pick of #${pullNumber}`
    })).data;
    pullRequestCreated = true;

    core.setOutput('branch_name', branchName);
    core.setOutput('pull_request_number', String(pullRequest.number));
    core.setOutput('pull_request_url', pullRequest.html_url);
    core.info(`Cherry-pick branch updated to ${headSha}.`);
    core.info(`Created pull request #${pullRequest.number}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (branchCreated && !pullRequestCreated) {
      try {
        await client.rest.git.deleteRef({
          ...context.repo,
          ref: `heads/${branchName}`
        });
      } catch (cleanupError) {
        const cleanupMessage = cleanupError instanceof Error
          ? cleanupError.message
          : String(cleanupError);
        core.warning(`Could not delete incomplete branch ${branchName}: ${cleanupMessage}`);
      }
    }

    core.setFailed(message);
  }
}

export {
  getPullCommitShas,
  parsePullNumber,
  runAction,
  validateBranchName
};
