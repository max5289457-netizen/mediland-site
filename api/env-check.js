export default function handler(req, res) {
  const hasGithubToken = Boolean(process.env.GITHUB_TOKEN);
  const hasGithubOwner = Boolean(process.env.VERCEL_GIT_REPO_OWNER || process.env.GITHUB_OWNER);
  const hasGithubRepo = Boolean(process.env.VERCEL_GIT_REPO_SLUG || process.env.GITHUB_REPO);
  const useGitHubStorage = hasGithubToken && hasGithubOwner && hasGithubRepo;

  const envVars = {
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN ? '✅ SET (' + process.env.TELEGRAM_BOT_TOKEN.length + ' chars)' : '❌ NOT SET',
    GITHUB_TOKEN: hasGithubToken ? '✅ SET (' + process.env.GITHUB_TOKEN.length + ' chars)' : '❌ NOT SET',
    GITHUB_OWNER: process.env.VERCEL_GIT_REPO_OWNER || process.env.GITHUB_OWNER || '❌ NOT SET',
    GITHUB_REPO: process.env.VERCEL_GIT_REPO_SLUG || process.env.GITHUB_REPO || '❌ NOT SET',
    VERCEL_ENV: process.env.VERCEL_ENV || 'local',
    VERCEL_URL: process.env.VERCEL_URL || 'local',
    VERCEL_GIT_REPO_OWNER: process.env.VERCEL_GIT_REPO_OWNER || '(not set)',
    VERCEL_GIT_REPO_SLUG: process.env.VERCEL_GIT_REPO_SLUG || '(not set)'
  };

  const status = {
    github_storage_enabled: useGitHubStorage ? '✅ YES' : '❌ NO (data will NOT persist on Vercel!)',
    storage_type: useGitHubStorage ? '📁 GitHub (persistent)' : (process.env.VERCEL ? '⚠️ Vercel Memory (not persistent!)' : '💾 Local Filesystem'),
    telegram_ready: process.env.TELEGRAM_BOT_TOKEN ? '✅ YES' : '❌ NO',
    webhook_url: req.headers.host ? `https://${req.headers.host}/api/telegram` : 'unknown'
  };

  res.status(200).json({
    message: 'Environment variables check',
    status,
    env: envVars,
    timestamp: new Date().toISOString(),
    warnings: useGitHubStorage ? [] : ['⚠️ GitHub storage is disabled! Data will not persist on Vercel.']
  });
}