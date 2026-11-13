# cherry-pick-action

Cherry-pick all commits from a pull request onto a target branch and open a new pull request.

## Usage

```yaml
permissions:
  contents: write
  pull-requests: write

steps:
  - name: Cherry-pick pull request
    uses: cpanato/cherry-pick-action@v1.0.0
    with:
      token: ${{ secrets.GITHUB_TOKEN }}
      pull_number: 123
      to_branch: stable
```

The `v1.0.0` release has [known dependency audit findings](https://github.com/cpanato/cherry-pick-action/releases/tag/v1.0.0).

The token must be able to read the source pull request, create and delete branches, and create pull requests. Prefer the workflow's `GITHUB_TOKEN` with the permissions above over a more broadly privileged personal access token. Ensure the workflow's trigger and token policy allow these write permissions.

`pull_number` must be a positive pull request number. `to_branch` is the target branch name, not a fully qualified ref such as `refs/heads/stable`. The action creates a uniquely named `cherry-pick-*` branch. If cherry-picking or pull request creation fails after branch creation, it attempts to delete that branch.

Merge commits in the source pull request are not supported by the cherry-pick implementation.

## Outputs

| Name | Description |
| --- | --- |
| `branch_name` | Name of the created cherry-pick branch. |
| `pull_request_number` | Number of the created pull request. |
| `pull_request_url` | URL of the created pull request. |

## Development

Use `nvm install` and `nvm use` to select the Node.js version in `.nvmrc`. Install dependencies with `npm ci`, rebuild the action bundle with `npm run build`, then run all unit and bundled-action integration tests with `npm test`. CI also tests Node 24, the GitHub Actions runtime, checks that the bundle is up to date, and runs the action through the GitHub Actions runner against a local mock API. This runner test does not create real GitHub branches or pull requests.

## Releases

Push a semantic-version tag such as `v1.2.3` to create an immutable GitHub Release with generated notes. Consumers should use a full release tag and update it explicitly for new releases; do not create or move a major-version tag.
