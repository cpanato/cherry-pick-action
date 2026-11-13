import { randomUUID } from 'node:crypto';

// Based on github-cherry-pick; see THIRD_PARTY_NOTICES.
async function cherryPickCommits({ owner, repo, octokit, head, commits, warn }) {
  const repository = { owner, repo };
  const ref = `cherry-pick-${head}-${randomUUID()}`;
  const headRef = (await octokit.git.getRef({ ...repository, ref: `heads/${head}` })).data;
  let sha = headRef.object.sha;
  let tree = (await octokit.git.getCommit({ ...repository, commit_sha: sha })).data.tree.sha;

  await octokit.git.createRef({ ...repository, ref: `refs/heads/${ref}`, sha });
  let failed = false;
  try {
    for (const commit of commits) {
      const source = (await octokit.git.getCommit({ ...repository, commit_sha: commit })).data;
      if (source.parents.length !== 1) {
        throw new Error(`Commit ${commit} has ${source.parents.length} parents; only commits with one parent are supported.`);
      }

      const sibling = (await octokit.git.createCommit({
        ...repository,
        author: source.author,
        committer: source.committer,
        message: `Sibling of ${commit} [skip ci]\n\n\nskip-checks: true\n`,
        parents: [source.parents[0].sha],
        tree
      })).data.sha;
      await octokit.git.updateRef({
        ...repository, ref: `heads/${ref}`, sha: sibling, force: true
      });

      const merge = await octokit.repos.merge({
        ...repository,
        base: ref,
        head: commit,
        commit_message: `Merge ${commit} into ${ref} [skip ci]\n\n\nskip-checks: true\n`
      });
      if (merge.status !== 204) {
        tree = merge.data.commit.tree.sha;
      }

      sha = (await octokit.git.createCommit({
        ...repository,
        author: source.author,
        committer: source.committer,
        message: source.message,
        parents: [sha],
        tree
      })).data.sha;
      await octokit.git.updateRef({
        ...repository, ref: `heads/${ref}`, sha, force: true
      });
    }
    await octokit.git.updateRef({
      ...repository, ref: `heads/${head}`, sha, force: false
    });
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    try {
      await octokit.git.deleteRef({ ...repository, ref: `heads/${ref}` });
    } catch (error) {
      if (!failed) throw error;
      warn(`Could not delete temporary branch ${ref}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return sha;
}

export { cherryPickCommits };
