// Упрощённый Telegram webhook без зависимостей

const HELP_TEXT = 'Привет! Я бот для сотрудников Медиленд.\n\n' +
  'Я принимаю заявки с сайта и отправляю их сотруднику, который сейчас на смене.\n' +
  'Если никто не на смене, я сохраню заявку и пришлю её, когда смена начнётся.\n\n' +
  'Команды:\n' +
  '/регистрация пароль имя — создать аккаунт\n' +
  '/войти имя пароль — войти и начать смену\n' +
  '/начать_смену — включить смену\n' +
  '/закончить_смену — закончить смену\n' +
  '/статус — проверить статус\n' +
  '/отписаться — удалить себя из списка';

function normalizeText(text) {
  return String(text || '').trim();
}

export default async function handler(req, res) {
  try {
    console.log('=== TELEGRAM WEBHOOK DEBUG ===');
    console.log('Method:', req.method);
    console.log('URL:', req.url);
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    console.log('TELEGRAM_BOT_TOKEN exists:', !!process.env.TELEGRAM_BOT_TOKEN);
    console.log('TELEGRAM_BOT_TOKEN length:', process.env.TELEGRAM_BOT_TOKEN?.length || 0);

    if (req.method === 'GET') {
      if (req.query?.setup === '1') {
        console.log('Setting up webhook...');
        const token = process.env.TELEGRAM_BOT_TOKEN;
        if (!token) {
          console.error('TELEGRAM_BOT_TOKEN not set!');
          return res.status(500).json({ ok: false, error: 'TELEGRAM_BOT_TOKEN not set' });
        }

        const baseUrl = process.env.VERCEL_URL || 'mediland-site.vercel.app';
        const webhookUrl = `https://${baseUrl}/api/telegram`;

        console.log('Webhook URL:', webhookUrl);
        console.log('Token exists:', !!token);

        const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: webhookUrl })
        });
        const result = await response.json();
        console.log('Webhook setup result:', result);
        return res.status(result.ok ? 200 : 500).json(result);
      }
      return res.status(200).json({ status: 'ok', message: 'Telegram webhook endpoint ready' });
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    // Проверяем токен
    if (!process.env.TELEGRAM_BOT_TOKEN) {
      console.error('TELEGRAM_BOT_TOKEN not configured');
      return res.status(500).json({ ok: false, error: 'Bot token not configured' });
    }

    console.log('Token is configured, parsing body...');

    // Простой парсинг без utils
    let body;
    try {
      if (req.body) {
        body = req.body;
      } else {
        const chunks = [];
        for await (const chunk of req) {
          chunks.push(chunk);
        }
        const rawBody = Buffer.concat(chunks).toString('utf-8');
        body = rawBody ? JSON.parse(rawBody) : {};
      }
      console.log('Body parsed successfully');
    } catch (error) {
      console.error('Failed to parse body:', error);
      return res.status(400).json({ ok: false, error: 'Invalid JSON' });
    }

    const message = body?.message || body?.edited_message;
    if (!message) {
      console.log('No message in body, returning OK');
      return res.status(200).json({ ok: true });
    }

    const chatId = message.chat.id;
    const text = normalizeText(message.text || '');

    console.log('Processing message:', { chatId, text });

    // Простой ответ для тестирования
    if (text === '/test') {
      try {
        console.log('Sending test message...');
        const response = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: '✅ Бот работает! Webhook активен.',
            parse_mode: 'HTML'
          })
        });
        const result = await response.json();
        console.log('Test message result:', result);
        if (!result.ok) {
          console.error('Telegram API error:', result);
          return res.status(500).json({ ok: false, error: 'Failed to send message' });
        }
      } catch (error) {
        console.error('Failed to send test message:', error);
        return res.status(500).json({ ok: false, error: 'Network error' });
      }
    }

    console.log('Message processed successfully');
    return res.status(200).json({ ok: true });

  } catch (error) {
    console.error('=== WEBHOOK ERROR ===');
    console.error('Error:', error);
    console.error('Stack:', error.stack);
    return res.status(500).json({ ok: false, error: error.message });
  }
}
    const remaining = subscribers.filter(item => item.chatId !== chatId);
    await saveJson('subscribers.json', remaining);
    await reply('✅ Вы удалены из списка сотрудников.');
    return res.status(200).json({ ok: true });
  }

  await reply(HELP_TEXT);
  return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Telegram webhook handler error:', error);
    return res.status(500).json({ ok: false, error: error.message || 'Internal server error' });
  }
}
