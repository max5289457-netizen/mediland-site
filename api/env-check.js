export default function handler(req, res) {
  const envVars = {
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN ? 'SET (' + process.env.TELEGRAM_BOT_TOKEN.length + ' chars)' : 'NOT SET',
    GITHUB_TOKEN: process.env.GITHUB_TOKEN ? 'SET (' + process.env.GITHUB_TOKEN.length + ' chars)' : 'NOT SET',
    VERCEL_ENV: process.env.VERCEL_ENV || 'unknown',
    VERCEL_URL: process.env.VERCEL_URL || 'unknown'
  };

  res.status(200).json({
    message: 'Environment variables check',
    env: envVars,
    timestamp: new Date().toISOString()
  });
}