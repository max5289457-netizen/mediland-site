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

    // Проверяем, что токен установлен
    if (!process.env.TELEGRAM_BOT_TOKEN) {
      console.error('TELEGRAM_BOT_TOKEN not set');
      return res.status(500).json({ ok: false, error: 'Bot token not configured' });
    }

    const body = await parseJsonBody(req);
    console.log('Parsed body:', JSON.stringify(body, null, 2));

    const message = body?.message || body?.edited_message;
    if (!message) {
      console.log('No message in body');
      return res.status(200).json({ ok: true });
    }

    const chatId = message.chat.id;
    const text = normalizeText(message.text || '');

    console.log('Processing message:', { chatId, text });

    const subscribers = await loadJson('subscribers.json');
    const pending = await loadJson('pending_notifications.json');

    const reply = async (textReply) => {
      try {
        await sendTelegramMessage(chatId, textReply);
        console.log('Reply sent successfully');
      } catch (error) {
        console.error('Failed to send reply:', error);
      }
    };

    if (text.startsWith('/start')) {
      await reply(HELP_TEXT);
      return res.status(200).json({ ok: true });
    }

    if (text.startsWith('/test')) {
      await reply('✅ Бот работает! Получено тестовое сообщение.');
      return res.status(200).json({ ok: true });
    }

    const registrationMatch = text.match(/^\/(?:employee|register|регистрация)\s+(\S+)\s+(.+)$/i);
    const loginMatch = text.match(/^\/войти\s+(.+)\s+(\S+)$/i);

    if (registrationMatch) {
      const employeePassword = registrationMatch[1].trim();
      const employeeName = registrationMatch[2].trim();

      const existingByName = subscribers.find(item => item.employeeName && item.employeeName.toLowerCase() === employeeName.toLowerCase());
      const existingByChat = subscribers.find(item => item.chatId === chatId);

      if (existingByName && existingByName.chatId !== chatId) {
        await reply('❌ Сотрудник с таким именем уже зарегистрирован. Выберите другое имя.');
        return res.status(200).json({ ok: true });
      }

      if (existingByChat) {
        existingByChat.employeeName = employeeName;
        existingByChat.employeePassword = employeePassword;
        existingByChat.chatId = chatId;
      } else {
        subscribers.push({
          chatId,
          employeeName,
          employeePassword,
          onShift: false,
          createdAt: new Date().toISOString()
        });
      }

      await saveJson('subscribers.json', subscribers);
      await reply(`✅ Вы зарегистрированы как сотрудник!\nИмя в системе: ${employeeName}`);
      return res.status(200).json({ ok: true });
    }

    if (loginMatch) {
      const employeeName = loginMatch[1].trim();
      const employeePassword = loginMatch[2].trim();
      const subscriber = subscribers.find(item => item.employeeName && item.employeeName.toLowerCase() === employeeName.toLowerCase());

      if (!subscriber) {
        await reply(`❌ Пользователь «${employeeName}» не найден. Зарегистрируйтесь командой /регистрация <пароль> <имя>.`);
        return res.status(200).json({ ok: true });
      }

      if (subscriber.employeePassword !== employeePassword) {
        await reply('❌ Неверный пароль. Попробуйте снова.');
        return res.status(200).json({ ok: true });
      }

      subscriber.chatId = chatId;
      subscriber.onShift = true;
      await saveJson('subscribers.json', subscribers);

      if (pending.length > 0) {
        const pendingCount = pending.length;
        const sentCount = await sendPendingNotifications(chatId, pending);
        pending.length = 0;
        await saveJson('pending_notifications.json', pending);
        await reply(`✅ Вы вошли как ${employeeName}. Отправлено ${sentCount} накопленных заявок.`);
        return res.status(200).json({ ok: true });
      }

      await reply(`✅ Вы вошли как ${employeeName} и теперь на смене.`);
      return res.status(200).json({ ok: true });
    }

    if (text === '/начать_смену') {
      const subscriber = subscribers.find(item => item.chatId === chatId);
      if (!subscriber) {
        await reply('⚠️ Вы ещё не зарегистрированы. Отправьте /регистрация <пароль> <имя>.');
        return res.status(200).json({ ok: true });
      }
      subscriber.onShift = true;
      await saveJson('subscribers.json', subscribers);

      if (pending.length > 0) {
        const sentCount = await sendPendingNotifications(chatId, pending);
        pending.length = 0;
        await saveJson('pending_notifications.json', pending);
        await reply(`✅ Вы начали смену. Отправлено ${sentCount} накопленных заявок.`);
        return res.status(200).json({ ok: true });
      }

      await reply('✅ Вы начали смену. Теперь вы будете получать уведомления.');
      return res.status(200).json({ ok: true });
    }

    if (text === '/закончить_смену') {
      const subscriber = subscribers.find(item => item.chatId === chatId);
      if (!subscriber) {
        await reply('⚠️ Вы ещё не зарегистрированы. Отправьте /регистрация <пароль> <имя>.');
        return res.status(200).json({ ok: true });
      }
      subscriber.onShift = false;
      await saveJson('subscribers.json', subscribers);
      await reply('✅ Вы закончили смену. Уведомления отключены.');
      return res.status(200).json({ ok: true });
    }

    if (text === '/статус') {
      const subscriber = subscribers.find(item => item.chatId === chatId);
      if (!subscriber) {
        await reply('⚠️ Вы ещё не зарегистрированы. Отправьте /регистрация <пароль> <имя>.');
        return res.status(200).json({ ok: true });
      }
      const status = subscriber.onShift ? 'На смене' : 'Не на смене';
      await reply(`✅ Статус:\nИмя: ${subscriber.employeeName}\nСмена: ${status}`);
      return res.status(200).json({ ok: true });
    }

    if (text === '/отписаться' || text === '/stop') {
      const subscriberIndex = subscribers.findIndex(item => item.chatId === chatId);
      if (subscriberIndex === -1) {
        await reply('⚠️ Вы ещё не зарегистрированы.');
        return res.status(200).json({ ok: true });
      }
      subscribers.splice(subscriberIndex, 1);
      await saveJson('subscribers.json', subscribers);
      await reply('✅ Вы отписались от уведомлений.');
      return res.status(200).json({ ok: true });
    }

    // Неизвестная команда
    await reply('❓ Неизвестная команда. Отправьте /start для справки.');
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
