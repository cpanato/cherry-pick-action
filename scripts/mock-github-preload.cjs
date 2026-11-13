if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.MOCK_GITHUB_API_URL ?? '')) {
  throw new Error('Mock GitHub API must use the local test server.');
}

process.env.GITHUB_API_URL = process.env.MOCK_GITHUB_API_URL;
