import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import cors from 'cors';
import Busboy from 'busboy';
import TelegramBot from 'node-telegram-bot-api';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TELEGRAM_BOT_TOKEN) {
  console.error('ERROR: TELEGRAM_BOT_TOKEN environment variable is required.');
  process.exit(1);
}
const PORT = Number(process.env.PORT || 3000);
const DB_FILE = path.resolve('subscribers.json');
const PENDING_FILE = path.resolve('pending_notifications.json');

function loadSubscribers() {
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    return [];
  }
}

function saveSubscribers(subscribers) {
  fs.writeFileSync(DB_FILE, JSON.stringify(subscribers, null, 2), 'utf-8');
}

function loadPendingNotifications() {
  try {
    const raw = fs.readFileSync(PENDING_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    return [];
  }
}

function savePendingNotifications(pending) {
  fs.writeFileSync(PENDING_FILE, JSON.stringify(pending, null, 2), 'utf-8');
}

function cleanupTempFiles(paths) {
  for (const filePath of paths) {
    try {
      fs.unlinkSync(filePath);
    } catch (error) {
      // ignore cleanup errors
    }
  }
}

function parseNotificationRequest(req) {
  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'] || '';
    if (!contentType.startsWith('multipart/form-data')) {
      return resolve({ fields: req.body || {}, photos: [] });
    }

    const busboy = new Busboy({ headers: req.headers });
    const fields = {};
    const photos = [];
    let pendingWrites = 0;
    let finished = false;

    const tryFinish = () => {
      if (finished && pendingWrites === 0) {
        resolve({ fields, photos });
      }
    };

    busboy.on('field', (fieldname, val) => {
      fields[fieldname] = val;
    });

    busboy.on('file', (fieldname, file, filename, encoding, mimetype) => {
      if (fieldname !== 'photos') {
        file.resume();
        return;
      }

      pendingWrites += 1;
      const tempPath = path.join(os.tmpdir(), `mediland-${Date.now()}-${Math.random().toString(36).slice(2)}-${filename}`);
      const writeStream = fs.createWriteStream(tempPath);
      file.pipe(writeStream);

      writeStream.on('finish', () => {
        photos.push({ filename, contentType: mimetype, tempPath });
        pendingWrites -= 1;
        tryFinish();
      });

      writeStream.on('error', (error) => {
        pendingWrites -= 1;
        reject(error);
      });
    });

    busboy.on('finish', () => {
      finished = true;
      tryFinish();
    });

    busboy.on('error', reject);
    req.pipe(busboy);
  });
}

function buildPhotoCaption(photoCount) {
  if (!photoCount) return '';
  return `
<b>📷 Фото:</b> ${photoCount} шт.`;
}

function savePendingPhotos(photos) {
  return photos.map((photo) => ({
    filename: photo.filename,
    contentType: photo.contentType,
    base64: fs.readFileSync(photo.tempPath, { encoding: 'base64' })
  }));
}

function buildPhotoSource(photo, tempFiles) {
  if (photo.tempPath && fs.existsSync(photo.tempPath)) {
    return fs.createReadStream(photo.tempPath);
  }

  const tempPath = path.join(os.tmpdir(), `mediland-send-${Date.now()}-${Math.random().toString(36).slice(2)}-${photo.filename}`);
  fs.writeFileSync(tempPath, photo.base64, 'base64');
  tempFiles.push(tempPath);
  return fs.createReadStream(tempPath);
}

async function sendPhotos(chatId, photos) {
  if (!photos || photos.length === 0) return;

  const tempFiles = [];
  try {
    if (photos.length === 1) {
      const photo = photos[0];
      const source = buildPhotoSource(photo, tempFiles);
      await bot.sendPhoto(chatId, source, { caption: '📷 Фото пациента' });
      console.log(`    ✅ Одиночное фото отправлено (${photo.filename})`);
      return;
    }

    console.log(`    📤 Отправляю группу из ${photos.length} фото...`);
    const media = photos.map((photo) => ({
      type: 'photo',
      media: buildPhotoSource(photo, tempFiles),
      filename: photo.filename
    }));

    await bot.sendMediaGroup(chatId, media);
    console.log(`    ✅ Группа фото отправлена (${photos.length} шт.)`);
  } catch (error) {
    console.error(`    ❌ Ошибка отправки фото:`, error.message);
    throw error;
  } finally {
    cleanupTempFiles(tempFiles);
  }
}

function findSubscriber(chatId) {
  const list = loadSubscribers();
  return list.find(item => item.chatId === chatId);
}

function findSubscriberByName(name) {
  const list = loadSubscribers();
  return list.find(item => item.employeeName && item.employeeName.toLowerCase() === name.toLowerCase());
}

function registerSubscriber({ chatId, firstName, lastName, username, employeeName, employeePassword }) {
  const list = loadSubscribers();
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
    existingByChat.chatId = chatId;
  } else {
    list.push({
      chatId,
      firstName,
      lastName,
      username,
      employeeName: employeeName || `${firstName} ${lastName}`.trim(),
      employeePassword,
      onShift: false,
      createdAt: new Date().toISOString()
    });
  }

  saveSubscribers(list);
  return { ok: true };
}

function unregisterSubscriber(chatId) {
  const list = loadSubscribers().filter(item => item.chatId !== chatId);
  saveSubscribers(list);
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

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });

bot.on('polling_error', (error) => {
  console.error('Telegram polling_error:', error.code, error.response?.body || error.message);
});

bot.getMe()
  .then((me) => {
    console.log('Telegram bot started as @' + me.username);
    return bot.deleteWebHook();
  })
  .then(() => {
    return bot.startPolling({ interval: 1000, autoStart: true });
  })
  .catch((error) => {
    console.error('Telegram bot startup failed:', error.response?.body || error.message);
    process.exit(1);
  });

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(chatId, 'Привет! Это бот для сотрудников Медиленд. Для регистрации отправьте команду /регистрация <пароль> <имя>. Для входа используйте /войти <имя> <пароль>.', buildBotKeyboard());
});

bot.onText(/\/(?:employee|регистрация)(?:\s+(\S+))?(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const employeePassword = match[1];
  const employeeName = match[2] ? match[2].trim() : '';

  if (!employeePassword || !employeeName) {
    await bot.sendMessage(chatId, 'Укажите пароль и имя: /регистрация <пароль> <имя>');
    return;
  }

  const firstName = msg.from.first_name || '';
  const lastName = msg.from.last_name || '';
  const username = msg.from.username || '';

  const result = registerSubscriber({ chatId, firstName, lastName, username, employeeName, employeePassword });
  if (!result.ok) {
    await bot.sendMessage(chatId, `❌ ${result.error}`, buildBotKeyboard());
    return;
  }

  await bot.sendMessage(chatId, `✅ Вы зарегистрированы как сотрудник!\nИмя в системе: ${employeeName}`, buildBotKeyboard());
});

bot.onText(/\/войти(?:\s+(\S+))?(?:\s+(\S+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const employeeName = match[1] ? match[1].trim() : '';
  const employeePassword = match[2] ? match[2].trim() : '';

  if (!employeeName || !employeePassword) {
    await bot.sendMessage(chatId, 'Введите имя и пароль для входа: /войти <имя> <пароль>');
    return;
  }

  const list = loadSubscribers();
  const subscriber = list.find(item => item.employeeName && item.employeeName.toLowerCase() === employeeName.toLowerCase());
  if (!subscriber) {
    await bot.sendMessage(chatId, `Пользователь с именем «${employeeName}» не найден. Зарегистрируйтесь командой /employee <пароль> <имя>.`, buildBotKeyboard());
    return;
  }

  if (subscriber.employeePassword !== employeePassword) {
    await bot.sendMessage(chatId, '❌ Неверный пароль. Попробуйте снова.', buildBotKeyboard());
    return;
  }

  subscriber.chatId = chatId;
  subscriber.onShift = true;
  saveSubscribers(list);

  const pending = loadPendingNotifications();
  if (pending.length > 0) {
    let sentCount = 0;
    const failedNotifications = [];
    
    for (let i = 0; i < pending.length; i++) {
      const notification = pending[i];
      try {
        console.log(`Отправка очередного уведомления ${i + 1} из ${pending.length} при входе ${employeeName}`);
        await bot.sendMessage(chatId, notification.message, { parse_mode: 'HTML' });
        
        if (notification.photos && notification.photos.length > 0) {
          console.log(`Отправка ${notification.photos.length} фото к уведомлению ${i + 1}`);
          await sendPhotos(chatId, notification.photos);
        }
        sentCount++;
        console.log(`✅ Уведомление ${i + 1} успешно отправлено`);
      } catch (error) {
        console.error(`❌ Ошибка отправки уведомления ${i + 1}:`, error.message);
        failedNotifications.push(notification);
      }
    }
    
    // Сохраняем только те уведомления, которые не были отправлены
    if (failedNotifications.length > 0) {
      console.log(`Сохраняю ${failedNotifications.length} неудачных уведомлений в очередь`);
      savePendingNotifications(failedNotifications);
    } else {
      savePendingNotifications([]);
    }
    
    await bot.sendMessage(chatId, `✅ Вы вошли в систему как ${employeeName}. Отправлено ${sentCount} из ${pending.length} накопленных заявок.`, buildBotKeyboard());
  } else {
    await bot.sendMessage(chatId, `✅ Вы вошли в систему как ${employeeName}. Теперь вы на смене и будете получать заявки.`, buildBotKeyboard());
  }
});

bot.onText(/\/(?:register|регистрация)/, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(chatId, 'Используйте команду /регистрация <пароль> <имя> для регистрации как сотрудник.', buildBotKeyboard());
});

bot.onText(/\/статус/, async (msg) => {
  const chatId = msg.chat.id;
  const subscriber = findSubscriber(chatId);

  if (subscriber) {
    const shiftStatus = subscriber.onShift ? 'На смене' : 'Не на смене';
    const displayName = subscriber.employeeName || `${subscriber.firstName} ${subscriber.lastName}`.trim() || 'Сотрудник';
    await bot.sendMessage(chatId, `✅ Вы зарегистрированы как сотрудник.\nИмя: ${displayName}\nСтатус смены: ${shiftStatus}`, { parse_mode: 'HTML' });
  } else {
    await bot.sendMessage(chatId, '⚠️ Вы ещё не зарегистрированы. Отправьте /employee <пароль> <имя>.', buildBotKeyboard());
  }
});

bot.onText(/\/начать_смену/, async (msg) => {
  const chatId = msg.chat.id;
  const list = loadSubscribers();
  const subscriber = list.find(item => item.chatId === chatId);

  if (!subscriber) {
    await bot.sendMessage(chatId, '⚠️ Вы ещё не зарегистрированы. Отправьте /employee <пароль>.', buildBotKeyboard());
    return;
  }

  subscriber.onShift = true;
  saveSubscribers(list);

  const pending = loadPendingNotifications();
  if (pending.length > 0) {
    let sentCount = 0;
    const failedNotifications = [];
    
    for (let i = 0; i < pending.length; i++) {
      const notification = pending[i];
      try {
        console.log(`Отправка очередного уведомления ${i + 1} из ${pending.length} сотруднику ${chatId}`);
        await bot.sendMessage(chatId, notification.message, { parse_mode: 'HTML' });
        
        if (notification.photos && notification.photos.length > 0) {
          console.log(`Отправка ${notification.photos.length} фото к уведомлению ${i + 1}`);
          await sendPhotos(chatId, notification.photos);
        }
        sentCount++;
        console.log(`✅ Уведомление ${i + 1} успешно отправлено`);
      } catch (error) {
        console.error(`❌ Ошибка отправки уведомления ${i + 1}:`, error.message);
        failedNotifications.push(notification);
      }
    }
    
    // Сохраняем только те уведомления, которые не были отправлены
    if (failedNotifications.length > 0) {
      console.log(`Сохраняю ${failedNotifications.length} неудачных уведомлений в очередь`);
      savePendingNotifications(failedNotifications);
    } else {
      savePendingNotifications([]);
    }
    
    await bot.sendMessage(chatId, `✅ Вы начали смену. Отправлено ${sentCount} из ${pending.length} накопленных заявок.`, buildBotKeyboard());
  } else {
    await bot.sendMessage(chatId, '✅ Вы начали смену. Теперь вы будете получать уведомления о новых заявках.', buildBotKeyboard());
  }
});

bot.onText(/\/закончить_смену/, async (msg) => {
  const chatId = msg.chat.id;
  const list = loadSubscribers();
  const subscriber = list.find(item => item.chatId === chatId);

  if (!subscriber) {
    await bot.sendMessage(chatId, '⚠️ Вы ещё не зарегистрированы. Отправьте /employee <пароль>.', buildBotKeyboard());
    return;
  }

  subscriber.onShift = false;
  saveSubscribers(list);
  await bot.sendMessage(chatId, '✅ Вы закончили смену. Уведомления отключены.', buildBotKeyboard());
});

bot.onText(/\/отписаться|\/stop/, async (msg) => {
  const chatId = msg.chat.id;
  unregisterSubscriber(chatId);
  await bot.sendMessage(chatId, '✅ Вы успешно отписались от уведомлений.', buildBotKeyboard());
});

bot.on('contact', async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(chatId, 'Контакты не нужны. Используйте /employee <пароль> для регистрации как сотрудник.');
});

bot.on('message', async (msg) => {
  const text = msg.text || '';
  if (['/employee', '/start', '/status', '/register', '/войти', '/начать_смену', '/закончить_смену', '/отписаться', '/stop'].includes(text) || text.startsWith('/employee ')) {
    return;
  }

  if (msg.contact) {
    return;
  }

  await bot.sendMessage(msg.chat.id, 'Для регистрации используйте команду /employee <пароль> <имя>, для входа — /войти <имя> <пароль>.');
});

const app = express();
app.use(cors());
app.use(express.json());

app.post('/notify', async (req, res) => {
  try {
    const { fields, photos } = await parseNotificationRequest(req);
    fields.photosCount = photos.length;
    const subscribers = loadSubscribers().filter(sub => sub.onShift);

    const messageText = buildNotificationMessage(fields);

    if (subscribers.length > 0) {
      console.log(`📨 Поступила новая заявка. Отправка ${subscribers.length} сотруднику(лицам) на смене`);
      const results = await Promise.all(subscribers.map(async (subscriber) => {
        try {
          console.log(`  📤 Отправляю уведомление сотруднику ${subscriber.employeeName} (chatId: ${subscriber.chatId})`);
          await bot.sendMessage(subscriber.chatId, messageText, { parse_mode: 'HTML' });
          if (photos.length > 0) {
            console.log(`  📷 Отправляю ${photos.length} фото сотруднику ${subscriber.employeeName}`);
            const pendingPhotos = savePendingPhotos(photos);
            await sendPhotos(subscriber.chatId, pendingPhotos);
          }
          console.log(`  ✅ Уведомление успешно отправлено ${subscriber.employeeName}`);
          return { chatId: subscriber.chatId, ok: true };
        } catch (error) {
          console.error(`  ❌ Ошибка отправки ${subscriber.employeeName}:`, error.message);
          return { chatId: subscriber.chatId, ok: false, error: error.message };
        }
      }));

      const successCount = results.filter(r => r.ok).length;
      console.log(`✅ Заявка обработана: успешно отправлено ${successCount} из ${subscribers.length} сотрудников`);
      res.json({ ok: true, sent: successCount, total: subscribers.length, results });
    } else {
      console.log('📦 Нет сотрудников на смене. Сохраняю заявку в очередь');
      const pending = loadPendingNotifications();
      const photoData = savePendingPhotos(photos);
      pending.push({ message: messageText, timestamp: new Date().toISOString(), photos: photoData });
      savePendingNotifications(pending);
      console.log(`📋 Очередь уведомлений: ${pending.length} заявок`);
      res.json({ ok: true, queued: true, message: 'Заявка сохранена в очередь. Будет отправлена сотруднику при начале смены.' });
    }

    cleanupTempFiles(photos.map(photo => photo.tempPath));
  } catch (error) {
    console.error('Ошибка обработки запроса /notify:', error);
    res.status(500).json({ ok: false, error: 'Ошибка обработки формы. Попробуйте ещё раз.' });
  }
});

app.get('/subscribers', (req, res) => {
  res.json(loadSubscribers());
});

app.listen(PORT, () => {
  console.log(`Server started on http://localhost:${PORT}`);
});

function buildNotificationMessage(data) {
  let text = '<b>📋 Новая заявка с сайта Медиленд</b>\n\n';
  if (data.fullName) text += `<b>👤 ФИО:</b> ${escapeHtml(data.fullName)}\n`;
  if (data.branch) text += `<b>🏢 Филиал:</b> ${escapeHtml(data.branch)}\n`;
  if (data.birthDate) text += `<b>📅 Дата рождения:</b> ${escapeHtml(data.birthDate)}\n`;
  if (data.phone) text += `<b>📱 Телефон:</b> ${escapeHtml(data.phone)}\n`;
  if (data.email) text += `<b>📧 Email:</b> ${escapeHtml(data.email)}\n`;
  if (data.rehabType) text += `<b>🏥 Тип реабилитации:</b> ${escapeHtml(data.rehabType)}\n`;
  if (data.message) text += `\n<b>📝 Сообщение:</b>\n${escapeHtml(data.message)}\n`;
  if (data.photosCount && data.photosCount > 0) text += `<b>📷 Фото:</b> ${data.photosCount} шт.\n`;
  text += `\n<b>⏰ Время:</b> ${new Date().toLocaleString('ru-RU')}`;
  return text;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}