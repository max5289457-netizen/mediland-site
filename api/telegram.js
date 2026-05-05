// Упрощённый Telegram webhook без зависимостей

function handler(req, res) {
  console.log('=== TELEGRAM WEBHOOK ===');
  console.log('Method:', req.method);

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error('TELEGRAM_BOT_TOKEN not set!');
    return res.status(500).json({ ok: false, error: 'TELEGRAM_BOT_TOKEN not set' });
  }

  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok', message: 'Telegram webhook ready' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  // Для POST просто возвращаем OK
  console.log('POST request received, returning OK');
  return res.status(200).json({ ok: true });
}

export default handler;
