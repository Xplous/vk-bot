import { Telegraf, Markup } from 'telegraf';
import Database from 'better-sqlite3';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.resolve(__dirname, '../data.db');
console.log('🔧 Using DB file:', dbPath);

const db = new Database(dbPath);

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
    console.error('❌ BOT_TOKEN не найден в .env');
    process.exit(1);
}

function initDB() {
    db.prepare(`
        CREATE TABLE IF NOT EXISTS applications (
                                                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                                                    user_id INTEGER NOT NULL,
                                                    username TEXT,
                                                    application_text TEXT NOT NULL,
                                                    created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `).run();

    console.log('✅ SQLite таблица applications готова');
}

const bot = new Telegraf(BOT_TOKEN);

const waitingForApplication = new Set<number>();
const userLastSubmission = new Map<number, number>();
const SUBMISSION_COOLDOWN = 60 * 1000;

const mainMenu = Markup.inlineKeyboard([
    Markup.button.callback('📝 Оставить заявку', 'start_application'),
]);

bot.telegram.setMyCommands([
    { command: 'start', description: 'Запустить бота' },
    { command: 'apply', description: 'Оставить заявку' },
]);

bot.use(async (ctx, next) => {
    console.log(`📨 Сообщение от ${ctx.from?.username || ctx.from?.id}`);
    await next();
});

bot.start((ctx) => {
    ctx.reply('👋 Привет! Выберите действие:', mainMenu);
});

bot.command('apply', (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    waitingForApplication.add(userId);
    ctx.reply('🚀 Ваша заявка — первый шаг к готовому решению. Опишите задачу, и мы предложим реализацию.');
});

bot.action('start_application', (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    waitingForApplication.add(userId);
    ctx.answerCbQuery();
    ctx.editMessageText('🚀 Ваша заявка — первый шаг к готовому решению. Опишите задачу, и мы предложим реализацию.');
});

bot.on('text', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const now = Date.now();
    const last = userLastSubmission.get(userId);

    if (last && now - last < SUBMISSION_COOLDOWN) {
        const secondsLeft = Math.ceil((SUBMISSION_COOLDOWN - (now - last)) / 1000);
        await ctx.reply(`⏱ Подождите ${secondsLeft} сек. перед повторной отправкой заявки.`);
        return;
    }

    if (waitingForApplication.has(userId)) {
        const text = ctx.message?.text;
        if (!text) return;

        try {
            db.prepare(`
                INSERT INTO applications (user_id, username, application_text)
                VALUES (?, ?, ?)
            `).run(userId, ctx.from?.username || null, text);

            waitingForApplication.delete(userId);
            userLastSubmission.set(userId, now);

            await ctx.reply('✅ Ваша заявка получена и сохранена, спасибо!');

            // Для отладки - выводим в консоль заявки
            const rows = db.prepare('SELECT * FROM applications').all();
            console.log('📋 Текущие заявки:', rows);
        } catch (e) {
            console.error('Ошибка записи заявки в SQLite:', e);
            await ctx.reply('❌ Ошибка при сохранении заявки, попробуйте позже.');
        }
    } else {
        await ctx.reply('❗️ Вы не находитесь в режиме подачи заявки. Используйте /apply или нажмите кнопку "📝 Оставить заявку".');
    }
});

(async () => {
    initDB();
    await bot.launch();
})();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
