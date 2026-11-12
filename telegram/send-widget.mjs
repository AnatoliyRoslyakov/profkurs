import { readFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

const usage = 'Node.js 18+ · node telegram/send-widget.mjs CHAT_ID\n' +
  'Укажите числовой ID личного чата с ботом и задайте TELEGRAM_BOT_TOKEN в окружении.';

async function send() {
  const args = process.argv.slice(2);
  if (args.length === 1 && ['-h', '--help'].includes(args[0])) {
    console.log(usage);
    return;
  }
  const chatId = Number(args[0]);
  if (args.length !== 1 || !/^[1-9]\d*$/.test(args[0]) || !Number.isSafeInteger(chatId)) {
    throw new Error(usage);
  }
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !/^\d+:[A-Za-z0-9_-]+$/.test(token)) {
    throw new Error('Задайте токен бота через переменную окружения TELEGRAM_BOT_TOKEN.');
  }

  async function call(method, payload = {}) {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000)
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      const reason = String(result.description || response.status).replaceAll(token, '[скрыто]');
      throw new Error(`Telegram (${method}): ${reason}`);
    }
    return result.result;
  }

  const bot = await call('getMe');
  if (!bot.has_main_web_app) {
    throw new Error('Подключите основное Mini App к этому боту в @BotFather, чтобы ссылка открывала «Профкурс».');
  }
  if (!/^[A-Za-z0-9_]{1,32}$/.test(bot.username || '')) {
    throw new Error('Telegram не вернул имя пользователя бота.');
  }
  const template = await readFile(new URL('widget.html', import.meta.url), 'utf8');
  const html = template.replace('__BOT_USERNAME__', bot.username);
  if (Buffer.byteLength(html) > 32768 || deflateSync(html, { level: 9 }).length > 4096) {
    throw new Error('HTML превышает лимит размера виджета Telegram.');
  }
  const message = await call('sendWidget', {
    chat_id: chatId,
    html,
    caption: `<a href="https://t.me/${bot.username}?startapp">Открыть «Профкурс» с начала</a>`,
    parse_mode: 'HTML'
  });
  console.log(`Виджет отправлен. ID сообщения: ${message.message_id}`);
}

send().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
