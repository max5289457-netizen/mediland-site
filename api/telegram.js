import { loadJson, saveJson, getWebhookUrl, sendTelegramMessage, sendTelegramPhoto } from './utils.js';

const HELP_TEXT = 'Привет! Я бот для сотрудников Медиленд.\n\n' +
  'Я принимаю заявки с сайта и отправляю их сотруднику, который сейчас на смене.\n' +
  'Если никто не на смене, я сохраню заявку и пришлю её, когда смена начнётся.\n\n' +
  'Команды:\n' +
  '/регистрация <пароль> <имя> — создать аккаунт\n' +
  '/войти <имя> <пароль> — войти и начать смену\n' +
  '/начать_смену — включить смену\n' +
  '/закончить_смену — закончить смену\n' +
  '/статус — проверить статус\n' +
  '/отписаться — удалить себя из списка';

function normalizeText(text) {
  return String(text || '').trim();
}

function buildBotKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: '/войти' }, { text: '/начать_смену' }],
        [{ text: '/закончить_смену' }, { text: '/статус' }],
        [{ text: '/отписаться' }]
      ],
      resize_keyboard: true,
      one_time_keyboard: false
    }
  };
}

async function loadSubscribers() {
  return await loadJson('subscribers.json');
}

async function saveSubscribers(data) {
  return await saveJson('subscribers.json', data);
}

async function loadPendingNotifications() {
  return await loadJson('pending_notifications.json');
}

async function savePendingNotifications(data) {
  return await saveJson('pending_notifications.json', data);
}

function findSubscriberByChatId(list, chatId) {
  return list.find(item => item.chatId === chatId);
}

function findSubscriberByName(list, name) {
  return list.find(item => item.employeeName && item.employeeName.toLowerCase() === name.toLowerCase());
}

function registerSubscriber(list, { chatId, firstName, lastName, username, employeeName, employeePassword }) {
  const existingByName = employeeName ? list.find(item => item.employeeName && item.employeeName.toLowerCase() === employeeName.toLowerCase()) : null;
  const existingByChat = list.find(item => item.chatId === chatId);

  if (existingByName && existingByName.chatId !== chatId) {
    return { ok: false, error: 'Сотрудник с таким именем уже зарегистрирован. Войдите в систему или выберите другое имя.' };
  }

  if (existingByChat) {
    existingByChat.firstName = firstName;
    existingByChat.lastName = lastName;
    existingByChat.username = username;
    existingByChat.employeeName = employeeName;
    existingByChat.employeePassword = employeePassword;
    existingByChat.onShift = false;
  } else {
    list.push({
      chatId,
      firstName,
      lastName,
      username,
      employeeName,
      employeePassword,
      onShift: false,
      createdAt: new Date().toISOString()
    });
  }

  return { ok: true };
}

function serializePendingPhotos(files) {
  return (files || []).map(file => ({
    filename: file.filename,
    mimetype: file.mimetype || 'application/octet-stream',
    base64: file.buffer.toString('base64')
  }));
}

function deserializePendingPhoto(photo) {
  return {
    filename: photo.filename,
    buffer: Buffer.from(photo.base64, 'base64'),
    mimetype: photo.mimetype || 'application/octet-stream'
  };
}

async function sendPendingNotifications(chatId, pending) {
  let sentCount = 0;
  const failedNotifications = [];

  for (let i = 0; i < pending.length; i++) {
    const notification = pending[i];
    try {
      console.log(`📨 Отправка очередного уведомления ${i + 1} из ${pending.length} при входе на смену`);
      await sendTelegramMessage(chatId, notification.message, { skipEscape: true });
      
      if (Array.isArray(notification.files) && notification.files.length > 0) {
        console.log(`📷 Отправка ${notification.files.length} фото к уведомлению ${i + 1}`);
        for (const file of notification.files) {
          try {
            const photo = deserializePendingPhoto(file);
            console.log(`   → ${photo.filename} (${photo.buffer?.length || 0} bytes)`);
            await sendTelegramPhoto(chatId, photo.buffer, photo.filename);
            console.log(`   ✅ ${photo.filename} отправлено`);
          } catch (photoError) {
            console.error(`   ❌ Ошибка отправки фото ${file.filename}:`, photoError.message);
            throw photoError;
          }
        }
      }
      sentCount++;
      console.log(`✅ Уведомление ${i + 1} успешно отправлено`);
    } catch (error) {
      console.error(`❌ Ошибка отправки уведомления ${i + 1}:`, error.message);
      if (String(error.message).includes('bot was blocked by the user') || String(error.message).includes('Forbidden')) {
        await disableBlockedSubscriber(chatId);
      }
      failedNotifications.push(notification);
    }
  }

  return { sentCount, failedNotifications };
}

async function deliverPendingNotifications(chatId) {
  const pending = await loadPendingNotifications();
  if (!Array.isArray(pending) || pending.length === 0) {
    console.log('📋 Очередь пуста, нечего отправлять');
    return 0;
  }

  console.log(`📦 Начинаю отправку ${pending.length} накопленных уведомлений`);
  const result = await sendPendingNotifications(chatId, pending);

  // Сохраняем только те уведомления, которые не были отправлены
  if (result.failedNotifications.length > 0) {
    console.log(`⚠️ Не удалось отправить ${result.failedNotifications.length} уведомлений, сохраняю в очередь`);
    await savePendingNotifications(result.failedNotifications);
  } else {
    console.log(`✅ Все ${result.sentCount} уведомлений успешно отправлены, очередь очищена`);
    await savePendingNotifications([]);
  }

  return result.sentCount;
}

async function setShiftStatus(chatId, onShift) {
  const list = await loadSubscribers();
  const subscriber = findSubscriberByChatId(list, chatId);
  if (!subscriber) {
    return { ok: false, error: 'Вы не зарегистрированы. Используйте /регистрация <пароль> <имя>.' };
  }
  subscriber.onShift = onShift;
  await saveSubscribers(list);
  return { ok: true, subscriber };
}

async function disableBlockedSubscriber(chatId) {
  const list = await loadSubscribers();
  const subscriber = findSubscriberByChatId(list, chatId);
  if (!subscriber) {
    return false;
  }
  if (subscriber.onShift) {
    subscriber.onShift = false;
  }
  await saveSubscribers(list);
  console.log(`🔒 Пользователь ${subscriber.employeeName || chatId} помечен как не на смене после блокировки бота`);
  return true;
}

async function handleCommand(message) {
  const chatId = message.chat.id;
  const text = normalizeText(message.text || '');
  const parts = text.split(/\s+/).filter(Boolean);
  const command = parts[0] ? parts[0].toLowerCase() : '';
  const args = parts.slice(1);

  if (!command) {
    return sendTelegramMessage(chatId, HELP_TEXT, buildBotKeyboard());
  }

  if (command === '/start' || command === '/help') {
    return sendTelegramMessage(chatId, HELP_TEXT, buildBotKeyboard());
  }

  if (command === '/регистрация' || command === '/employee' || command === '/register') {
    const password = args[0];
    const employeeName = args.slice(1).join(' ').trim();
    if (!password || !employeeName) {
      return sendTelegramMessage(chatId, 'Укажите пароль и имя: /регистрация <пароль> <имя>', buildBotKeyboard());
    }

    const firstName = message.from?.first_name || '';
    const lastName = message.from?.last_name || '';
    const username = message.from?.username || '';
    const list = await loadSubscribers();
    const result = registerSubscriber(list, { chatId, firstName, lastName, username, employeeName, employeePassword: password });
    if (!result.ok) {
      return sendTelegramMessage(chatId, `❌ ${result.error}`, buildBotKeyboard());
    }

    await saveSubscribers(list);
    return sendTelegramMessage(chatId, `✅ Вы зарегистрированы как сотрудник!\nИмя в системе: ${employeeName}`, buildBotKeyboard());
  }

  if (command === '/войти' || command === '/login') {
    const employeeName = args[0] ? args[0].trim() : '';
    const password = args[1] ? args[1].trim() : '';
    if (!employeeName || !password) {
      return sendTelegramMessage(chatId, 'Введите имя и пароль для входа: /войти <имя> <пароль>', buildBotKeyboard());
    }

    const list = await loadSubscribers();
    const subscriber = findSubscriberByName(list, employeeName);
    if (!subscriber) {
      return sendTelegramMessage(chatId, `Пользователь с именем «${employeeName}» не найден. Зарегистрируйтесь командой /регистрация <пароль> <имя>.`, buildBotKeyboard());
    }
    if (subscriber.employeePassword !== password) {
      return sendTelegramMessage(chatId, '❌ Неверный пароль. Попробуйте снова.', buildBotKeyboard());
    }

    subscriber.chatId = chatId;
    subscriber.onShift = true;
    await saveSubscribers(list);
    const pendingCount = await deliverPendingNotifications(chatId);
    if (pendingCount > 0) {
      return sendTelegramMessage(chatId, `✅ Вы вошли в систему как ${employeeName}. Отправлено ${pendingCount} накопленных заявок.`, buildBotKeyboard());
    }
    return sendTelegramMessage(chatId, `✅ Вы вошли в систему как ${employeeName}. Теперь вы на смене и будете получать заявки.`, buildBotKeyboard());
  }

  if (command === '/начать_смену') {
    const result = await setShiftStatus(chatId, true);
    if (!result.ok) {
      return sendTelegramMessage(chatId, result.error, buildBotKeyboard());
    }
    const pendingCount = await deliverPendingNotifications(chatId);
    if (pendingCount > 0) {
      return sendTelegramMessage(chatId, `✅ Вы начали смену. Отправлено ${pendingCount} накопленных заявок.`, buildBotKeyboard());
    }
    return sendTelegramMessage(chatId, '✅ Вы начали смену. Теперь вы будете получать уведомления о новых заявках.', buildBotKeyboard());
  }

  if (command === '/закончить_смену') {
    const result = await setShiftStatus(chatId, false);
    if (!result.ok) {
      return sendTelegramMessage(chatId, result.error, buildBotKeyboard());
    }
    return sendTelegramMessage(chatId, '✅ Вы закончили смену. Уведомления отключены.', buildBotKeyboard());
  }

  if (command === '/статус') {
    const list = await loadSubscribers();
    const subscriber = findSubscriberByChatId(list, chatId);
    if (!subscriber) {
      return sendTelegramMessage(chatId, '⚠️ Вы ещё не зарегистрированы. Отправьте /регистрация <пароль> <имя>.', buildBotKeyboard());
    }
    const shiftStatus = subscriber.onShift ? 'На смене' : 'Не на смене';
    const displayName = subscriber.employeeName || `${subscriber.firstName} ${subscriber.lastName}`.trim() || 'Сотрудник';
    return sendTelegramMessage(chatId, `✅ Вы зарегистрированы как сотрудник.\nИмя: ${displayName}\nСтатус смены: ${shiftStatus}`, { skipEscape: true });
  }

  if (command === '/отписаться' || command === '/stop') {
    const list = await loadSubscribers();
    const remaining = list.filter(item => item.chatId !== chatId);
    await saveSubscribers(remaining);
    return sendTelegramMessage(chatId, '✅ Вы успешно отписались от уведомлений.', buildBotKeyboard());
  }

  return sendTelegramMessage(chatId, HELP_TEXT, buildBotKeyboard());
}

export default async function handler(req, res) {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      console.error('TELEGRAM_BOT_TOKEN not set!');
      return res.status(500).json({ ok: false, error: 'TELEGRAM_BOT_TOKEN not set' });
    }

    if (req.method === 'GET') {
      const setup = String(req.query?.setup || '').toLowerCase();
      if (setup === '1' || setup === 'true') {
        const webhookUrl = getWebhookUrl(req);
        const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook?url=${encodeURIComponent(webhookUrl)}`);
        const result = await response.json();
        return res.status(200).json({ ok: result.ok, result, webhookUrl });
      }
      return res.status(200).json({ status: 'ok', message: 'Telegram webhook ready', webhook: getWebhookUrl(req) });
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    const body = req.body || {};
    const message = body.message || body.edited_message || body.callback_query?.message;
    if (!message || !message.chat || !message.chat.id) {
      return res.status(200).json({ ok: true, message: 'Ignored non-message update' });
    }

    await handleCommand(message);
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Telegram webhook handler error:', error);
    return res.status(500).json({ ok: false, error: error.message || 'Internal server error' });
  }
}

