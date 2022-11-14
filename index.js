const core = require('@actions/core');
const github = require('@actions/github');
const cherry = require('github-cherry-pick');

async function createRef(client, context, ref, sha) {
  const response = await client.rest.git.createRef({
    ...context.repo,
    ref,
    sha
  });
  console.log(response);
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
  console.log(context, head, commits);
  const response = await cherry.cherryPickCommits({
    ...context.repo,
    octokit: octokit,
    head: head,
    commits: commits
  });
  console.log(response);
  return response;
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

    const cherryPicks = [];
    const branchName = `cherry-pick-${Date.now()}`;
    const branchRef = `heads/${toBranch}`;

    try {

      const newHeadSha = await cherryPickCommits(client, context, branchName, commits);
      console.log('cherry picke, creating branch');
      const newBranch = await createRef(client, context, `refs/${branchRef}`, newHeadSha);
      console.log('Successfully cherry picked commits:', newBranch);

      response.success = true;
      response.newBranch = newBranch;

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
