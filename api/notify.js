import { loadJson, saveJson, buildNotificationMessage, sendTelegramMessage, sendTelegramPhoto, parseFormData } from './utils.js';

function serializePendingFiles(files) {
  return (files || []).map(file => ({
    filename: file.filename,
    mimetype: file.mimetype || 'application/octet-stream',
    base64: file.buffer.toString('base64')
  }));
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
                await sendTelegramPhoto(subscriber.chatId, file.buffer, file.filename);
              } catch (photoError) {
                console.error(`  ❌ Ошибка фото ${file.filename} для ${subscriber.employeeName}:`, photoError.message);
                throw photoError;
              }
            }
          }
          console.log(`  ✅ Уведомление успешно отправлено ${subscriber.employeeName}`);
          return { chatId: subscriber.chatId, ok: true };
        } catch (error) {
          console.error(`  ❌ Ошибка отправки ${subscriber.employeeName}:`, error.message);
          return { chatId: subscriber.chatId, ok: false, error: error.message };
        }
      }));

      const successCount = results.filter(r => r.ok).length;
      console.log(`✅ Заявка обработана: успешно ${successCount} из ${onShift.length} сотрудников`);
      return res.status(200).json({ ok: true, sent: successCount, total: onShift.length, results });
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
