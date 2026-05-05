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

export default function handler(req, res) {
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
