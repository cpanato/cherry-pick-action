const core = require('@actions/core');
const github = require('@actions/github');
const cherry = require('github-cherry-pick');

async function getRef(client, context, ref) {
  const response = await client.rest.git.getRef({
    ...context.repo,
    ref
  });
  return response.data;
}

async function getPull(client, context, pullNumber) {
  const response = await client.rest.pulls.get({
    ...context.repo,
    pull_number: pullNumber
  });
  return response.data;
}

async function createRef(client, context, ref, sha) {
  const response = await client.rest.git.createRef({
    ...context.repo,
    ref,
    sha
  });
  return response.data;
}

async function getPullCommitShas(client, context, pullNumber) {
  const pullCommits = (await client.rest.pulls.listCommits({
    ...context.repo,
    pull_number: pullNumber
  })).data;
  const commits = pullCommits.map(commit => commit.sha);
  return commits;
}

async function cherryPickCommits(octokit, context, head, commits) {
  const response = await cherry.cherryPickCommits({
    ...context.repo,
    octokit,
    head,
    commits
  });
  console.log(response);
  return response;
}


async function createPull(client, context, branch, base, title, body) {
  const response = await client.request("POST /repos/{owner}/{repo}/pulls", {
    base: base,
    body: body,
    head: branch,
    ...context.repo,
    title: title
  });
  return response.data;
}

async function run() {
  try {
    const context = github.context;
    const token = core.getInput('token');
    const pullNumber = parseInt(core.getInput('pull_number'));
    const toBranch = core.getInput('to_branch');

    const client = github.getOctokit(token)

    console.log(`Repo: ${context.repo.owner}/${context.repo.repo}`);
    console.log('Pull request number:', pullNumber);
    console.log('To branch:', toBranch);
    console.log('Starting cherry pick...');

    const commits = await getPullCommitShas(client, context, pullNumber);
    console.log(JSON.stringify(commits));
    const oktokit = client.rest

    const cherryPicks = [];
    const branchName = `cherry-pick-${Date.now()}`;
    const branchRef = `refs/heads/${branchName}`;

    try {
      const baseBranchRef = await getRef(client, context, `heads/${toBranch}`);
      const newBranch = await createRef(client, context, branchRef, baseBranchRef.object.sha);
      const newHeadSha = await cherryPickCommits(oktokit, context, branchName, commits);
      console.log('Successfully cherry picked commits:', newHeadSha);

      const pull = await getPull(client, context, pullNumber);
      const title = `[CherryPick] ${pull.title}`
      const body = `Cherry pick of #${pullNumber}`
      const pullrquest = await createPull(client, context, branchName, toBranch, title, body);
      console.log('Successfully created a pull request:', pullrquest.number);
    } catch (error) {
      console.log('An error occurred while trying to cherry pick.');
      console.log(error);
      core.error(error);
      core.setFailed(error.message);
    }

    console.log(JSON.stringify(cherryPicks));
    // core.setOutput('cherry_picks', JSON.stringify(cherryPicks));
  } catch (error) {
    core.error(error);
    core.setFailed(error.message);
  }
}

run();
