import { loadJson, saveJson, buildNotificationMessage, sendTelegramMessage, parseJsonBody } from './utils.js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', ['POST']);
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    const data = await parseJsonBody(req);
    const subscribers = await loadJson('subscribers.json');
  const onShift = subscribers.filter(sub => sub.onShift);
  const messageText = buildNotificationMessage(data);

  if (onShift.length > 0) {
    const results = await Promise.all(onShift.map(async (subscriber) => {
      try {
        await sendTelegramMessage(subscriber.chatId, messageText);
        return { chatId: subscriber.chatId, ok: true };
      } catch (error) {
        return { chatId: subscriber.chatId, ok: false, error: error.message };
      }
    }));
    const successCount = results.filter(r => r.ok).length;
    return res.status(200).json({ ok: true, sent: successCount, total: onShift.length, results });
  }

  const pending = await loadJson('pending_notifications.json');
  pending.push({ message: messageText, timestamp: new Date().toISOString() });
  await saveJson('pending_notifications.json', pending);
  return res.status(200).json({ ok: true, queued: true, message: 'Никто не на смене. Заявка сохранена и будет отправлена при начале смены.' });
  } catch (error) {
    console.error('Notify handler error:', error);
    return res.status(500).json({ ok: false, error: error.message || 'Internal server error' });
  }
}
