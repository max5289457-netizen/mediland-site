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
    console.log('=== TELEGRAM WEBHOOK ===');
    console.log('Method:', req.method);
    console.log('URL:', req.url);

    // Проверяем токен сразу
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      console.error('TELEGRAM_BOT_TOKEN not set!');
      return res.status(500).json({ ok: false, error: 'TELEGRAM_BOT_TOKEN not set' });
    }
    console.log('Token OK, length:', token.length);

    if (req.method === 'GET') {
      if (req.query?.setup === '1') {
        console.log('Setting up webhook...');

        const baseUrl = process.env.VERCEL_URL || 'mediland-site.vercel.app';
        const webhookUrl = `https://${baseUrl}/api/telegram`;

        console.log('Webhook URL:', webhookUrl);

        const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: webhookUrl })
        });
        const result = await response.json();
        console.log('Webhook setup result:', result);
        return res.status(result.ok ? 200 : 500).json(result);
      }
      return res.status(200).json({ status: 'ok', message: 'Telegram webhook ready' });
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    console.log('Processing POST request...');

    // Парсим тело
    let body;
    try {
      if (req.body) {
        body = req.body;
        console.log('Using req.body');
      } else {
        console.log('Reading from stream...');
        const chunks = [];
        for await (const chunk of req) {
          chunks.push(chunk);
        }
        const rawBody = Buffer.concat(chunks).toString('utf-8');
        body = rawBody ? JSON.parse(rawBody) : {};
        console.log('Parsed from stream');
      }
    } catch (error) {
      console.error('Parse error:', error.message);
      return res.status(400).json({ ok: false, error: 'Invalid JSON' });
    }

    const message = body?.message || body?.edited_message;
    if (!message) {
      console.log('No message, returning OK');
      return res.status(200).json({ ok: true });
    }

    const chatId = message.chat?.id;
    const text = normalizeText(message.text || '');

    console.log('Message:', { chatId, text });

    if (text === '/test') {
      console.log('Sending test message...');
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: '✅ Бот работает! Webhook активен.',
          parse_mode: 'HTML'
        })
      });
      const result = await response.json();
      console.log('Send result:', result);
      if (!result.ok) {
        console.error('Telegram error:', result);
        return res.status(500).json({ ok: false, error: 'Telegram API error' });
      }
    }

    console.log('Request processed successfully');
    return res.status(200).json({ ok: true });

  } catch (error) {
    console.error('=== ERROR ===');
    console.error('Message:', error.message);
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
