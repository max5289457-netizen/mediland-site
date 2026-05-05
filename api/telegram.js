import { loadJson, saveJson, sendTelegramMessage, sendTelegramPhoto, getWebhookUrl, parseJsonBody } from './utils.js';

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

async function sendPendingNotifications(chatId, pending) {
  let sentCount = 0;
  for (const notification of pending) {
    try {
      // Отправка текстового сообщения
      await sendTelegramMessage(chatId, notification.message, { skipEscape: true });
      sentCount++;
      
      // Отправка фотографий если они есть
      if (notification.files && notification.files.length > 0) {
        for (const file of notification.files) {
          try {
            // Восстанавливаем Buffer из сохраненных данных
            const photoBuffer = Buffer.from(file.buffer.data || file.buffer);
            await sendTelegramPhoto(chatId, photoBuffer, file.filename);
          } catch (photoError) {
            console.error(`Failed to send photo from pending:`, photoError.message);
          }
        }
      }
    } catch (error) {
      console.error('Ошибка отправки pending notification:', error.message);
    }
  }
  return sentCount;
}

export default async function handler(req, res) {
  try {
    console.log('Telegram webhook received:', req.method, req.url);

    if (req.method === 'GET') {
      if (req.query?.setup === '1') {
        const webhookUrl = getWebhookUrl(req);
        const token = process.env.TELEGRAM_BOT_TOKEN;
        if (!token) {
          return res.status(500).json({ ok: false, error: 'TELEGRAM_BOT_TOKEN not set' });
        }
        const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: webhookUrl })
        });
        const result = await response.json();
        return res.status(result.ok ? 200 : 500).json(result);
      }
      return res.status(200).send('Telegram webhook endpoint');
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', ['POST', 'GET']);
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    // Простой тест - возвращаем OK для любого POST
    console.log('Received POST request to webhook');
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Webhook error:', error);
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
