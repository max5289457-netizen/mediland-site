import 'dotenv/config';
import fs from 'fs';
import path from 'path';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.VERCEL_GIT_REPO_OWNER || process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.VERCEL_GIT_REPO_SLUG || process.env.GITHUB_REPO;
const useGitHubStorage = Boolean(GITHUB_TOKEN && GITHUB_OWNER && GITHUB_REPO);

function localFilePath(filename) {
  return path.resolve(process.cwd(), filename);
}

export async function parseJsonBody(req) {
  // Vercel может уже распарсить тело
  if (req.body) {
    return req.body;
  }

  // Для других сред читаем поток
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const rawBody = Buffer.concat(chunks).toString('utf-8');
  if (!rawBody) {
    return {};
  }

  try {
    return JSON.parse(rawBody);
  } catch (error) {
    console.error('Failed to parse JSON body:', error.message);
    return {};
  }
}

export async function parseFormData(req) {
  const contentType = req.headers['content-type'] || '';
  
  // Если это JSON, парсим как обычно
  if (contentType.includes('application/json')) {
    return parseJsonBody(req);
  }

  // Если это FormData с файлами
  if (contentType.includes('multipart/form-data')) {
    const Busboy = (await import('busboy')).default;
    const busboy = Busboy({ headers: req.headers });
    
    const fields = {};
    const files = [];

    return new Promise((resolve, reject) => {
      busboy.on('file', (fieldname, file, info) => {
        const chunks = [];
        file.on('data', chunk => chunks.push(chunk));
        file.on('end', () => {
          files.push({
            fieldname,
            buffer: Buffer.concat(chunks),
            filename: info.filename,
            mimetype: info.encoding
          });
        });
      });

      busboy.on('field', (fieldname, val) => {
        fields[fieldname] = val;
      });

      busboy.on('error', reject);
      busboy.on('finish', () => {
        resolve({ ...fields, files });
      });

      req.pipe(busboy);
    });
  }

  // Если это обычные данные, парсим как JSON
  return parseJsonBody(req);
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeTelegramHtml(text) {
  return escapeHtml(text)
    .replace(/\n/g, '\n');
}

async function githubRequest(url, options = {}) {
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    'User-Agent': 'vercel-telegram-bot'
  };
  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(url, { ...options, headers });
  return response;
}

async function getGitHubFileInfo(filename) {
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(filename)}`;
  const response = await githubRequest(url);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GitHub API error (${response.status}): ${errorText}`);
  }
  return response.json();
}

export async function loadJson(filename) {
  if (useGitHubStorage) {
    const info = await getGitHubFileInfo(filename);
    if (!info || !info.content) {
      return [];
    }
    const content = Buffer.from(info.content, 'base64').toString('utf-8');
    return JSON.parse(content || '[]');
  }

  try {
    const raw = fs.readFileSync(localFilePath(filename), 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    return [];
  }
}

export async function saveJson(filename, data) {
  if (useGitHubStorage) {
    const info = await getGitHubFileInfo(filename);
    const body = {
      message: `Update ${filename} via Telegram bot`,
      content: Buffer.from(JSON.stringify(data, null, 2)).toString('base64')
    };
    if (info?.sha) {
      body.sha = info.sha;
    }
    const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(filename)}`;
    const response = await githubRequest(url, { method: 'PUT', body: JSON.stringify(body) });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GitHub update error (${response.status}): ${errorText}`);
    }
    return await response.json();
  }

  if (process.env.VERCEL) {
    throw new Error('Persistent storage on Vercel requires GITHUB_TOKEN and repo info.');
  }

  fs.writeFileSync(localFilePath(filename), JSON.stringify(data, null, 2), 'utf-8');
  return { ok: true };
}

export async function sendTelegramMessage(chatId, text, options = {}) {
  if (!TELEGRAM_BOT_TOKEN) {
    throw new Error('TELEGRAM_BOT_TOKEN is not set');
  }
  if (!chatId) {
    throw new Error('Telegram chatId is missing');
  }

  const messageText = options.skipEscape ? text : escapeTelegramHtml(text);
  const body = {
    chat_id: chatId,
    text: messageText,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...options
  };
  delete body.skipEscape;

  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const result = await response.json();
  if (!result.ok) {
    throw new Error(result.description || 'Telegram sendMessage failed');
  }

  return result;
}

export async function sendTelegramPhoto(chatId, photoBuffer, filename = 'photo.jpg') {
  if (!TELEGRAM_BOT_TOKEN) {
    throw new Error('TELEGRAM_BOT_TOKEN is not set');
  }
  if (!chatId) {
    throw new Error('Telegram chatId is missing');
  }

  const FormData = (await import('form-data')).default;
  const form = new FormData();
  form.append('chat_id', chatId);
  form.append('photo', photoBuffer, filename);

  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
    method: 'POST',
    body: form
  });

  const result = await response.json();
  if (!result.ok) {
    throw new Error(result.description || 'Telegram sendPhoto failed');
  }

  return result;
}

export function buildNotificationMessage(data) {
  let text = '<b>📋 Новая заявка с сайта</b>\n\n';
  if (data.fullName) text += `<b>👤 Имя:</b> ${escapeHtml(data.fullName)}\n`;
  if (data.birthDate) text += `<b>📅 Дата рождения:</b> ${escapeHtml(data.birthDate)}\n`;
  if (data.phone) text += `<b>📱 Телефон:</b> ${escapeHtml(data.phone)}\n`;
  if (data.email) text += `<b>📧 Email:</b> ${escapeHtml(data.email)}\n`;
  if (data.branch) text += `<b>🏢 Филиал:</b> ${escapeHtml(data.branch)}\n`;
  if (data.rehabType) text += `<b>🏥 Тип реабилитации:</b> ${escapeHtml(data.rehabType)}\n`;
  if (data.message) text += `\n<b>📝 Сообщение:</b>\n${escapeHtml(data.message)}\n`;
  if (data.photosCount != null) text += `<b>📎 Фото:</b> ${escapeHtml(data.photosCount)} шт.\n`;
  text += `\n<b>⏰ Время:</b> ${new Date().toLocaleString('ru-RU')}`;
  return text;
}

export function getWebhookUrl(req) {
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers.host;
  return `${protocol}://${host}/api/telegram`;
}
