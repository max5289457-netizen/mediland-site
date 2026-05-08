import { loadJson, saveJson, buildNotificationMessage, sendTelegramMessage, sendTelegramPhoto, parseFormData } from './utils.js';

function serializePendingFiles(files) {
  return (files || []).map(file => ({
    filename: file.filename,
    mimetype: file.mimetype || 'application/octet-stream',
    base64: file.buffer.toString('base64')
  }));
}

function isBlockedError(error) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('bot was blocked by the user') || message.includes('forbidden');
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', ['POST']);
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    const data = await parseFormData(req);
    const subscribers = await loadJson('subscribers.json');
    const onShift = subscribers.filter(sub => sub.onShift);

    if (Array.isArray(data.files)) {
      data.photosCount = data.files.length;
      console.log(`📸 Получено ${data.files.length} фото(графий) с заявкой`);
      data.files.forEach((file, idx) => {
        console.log(`   [${idx + 1}] ${file.filename} (${file.buffer?.length || 0} bytes, ${file.mimetype})`);
      });
    } else {
      console.log(`📋 Заявка без фото`);
    }

    const messageText = buildNotificationMessage(data);

    // Отправка текстового сообщения и фотографий
    if (onShift.length > 0) {
      console.log(`📨 Новая заявка. Отправка ${onShift.length} сотруднику(лицам) на смене`);
      const results = await Promise.all(onShift.map(async (subscriber) => {
        try {
          console.log(`  📤 Отправляю уведомление ${subscriber.employeeName} (chatId: ${subscriber.chatId})`);
          await sendTelegramMessage(subscriber.chatId, messageText, { skipEscape: true });

          if (Array.isArray(data.files) && data.files.length > 0) {
            console.log(`  📷 Отправляю ${data.files.length} фото ${subscriber.employeeName}`);
            for (const file of data.files) {
              try {
                console.log(`    → ${file.filename} (${file.buffer?.length || 0} bytes)`);
                await sendTelegramPhoto(subscriber.chatId, file.buffer, file.filename);
                console.log(`    ✅ ${file.filename} отправлено`);
              } catch (photoError) {
                console.error(`    ❌ Ошибка фото ${file.filename}:`, photoError.message);
                throw photoError;
              }
            }
          }
          console.log(`  ✅ Уведомление успешно отправлено ${subscriber.employeeName}`);
          return { chatId: subscriber.chatId, ok: true };
        } catch (error) {
          console.error(`  ❌ Ошибка отправки ${subscriber.employeeName}:`, error.message);
          if (isBlockedError(error)) {
            subscriber.onShift = false;
          }
          return { chatId: subscriber.chatId, ok: false, error: error.message, blocked: isBlockedError(error) };
        }
      }));

      const blockedCount = onShift.filter(sub => !sub.onShift).length;
      if (blockedCount > 0) {
        await saveJson('subscribers.json', subscribers);
        console.log(`⚠️ Снято с смены ${blockedCount} заблокированных пользователя(ей)`);
      }

      const successCount = results.filter(r => r.ok).length;
      const blockedResults = results.filter(r => r.blocked).length;
      const failedResults = results.length - successCount;

      if (successCount === 0) {
        console.log('⚠️ Все попытки отправки не удались. Сохраняю заявку в очередь.');
        const pending = await loadJson('pending_notifications.json');
        pending.push({
          message: messageText,
          files: serializePendingFiles(data.files),
          photosCount: data.photosCount || 0,
          timestamp: new Date().toISOString()
        });
        await saveJson('pending_notifications.json', pending);
        console.log(`📋 Очередь уведомлений: ${pending.length} заявок`);
        return res.status(200).json({ ok: true, queued: true, message: 'Никто не смог принять заявку. Она сохранена в очередь.', results, blocked: blockedResults });
      }

      console.log(`✅ Заявка обработана: успешно ${successCount} из ${onShift.length} сотрудников, ${failedResults} неудач.`);
      return res.status(200).json({ ok: true, sent: successCount, total: onShift.length, results, blocked: blockedResults });
    }

    // Сохранение в очередь если никого нет на смене
    console.log('📦 Нет сотрудников на смене. Сохраняю заявку в очередь');
    const pending = await loadJson('pending_notifications.json');
    pending.push({
      message: messageText,
      files: serializePendingFiles(data.files),
      photosCount: data.photosCount || 0,
      timestamp: new Date().toISOString()
    });
    await saveJson('pending_notifications.json', pending);
    console.log(`📋 Очередь уведомлений: ${pending.length} заявок`);

    return res.status(200).json({ ok: true, queued: true, message: 'Никто не на смене. Заявка сохранена и будет отправлена при начале смены.' });
  } catch (error) {
    console.error('Notify handler error:', error);
    return res.status(500).json({ ok: false, error: error.message || 'Internal server error' });
  }
}
