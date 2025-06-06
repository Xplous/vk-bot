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
const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID;
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

const mainMenu = Markup.keyboard([
    [Markup.button.text('📝 Оставить заявку')],
]).resize();

bot.use(async (ctx, next) => {
    if (ctx.chat?.type !== 'private') return; // 💬 Только личные сообщения
    console.log(`📨 Сообщение от ${ctx.from?.username || ctx.from?.id}`);
    await next();
});

bot.start((ctx) => {
    ctx.reply(
        '👋 Добро пожаловать!\n\n' +
        'Мы — команда, создающая IT-решения под ключ.\n' +
        'Оставьте заявку — и мы предложим, как реализовать ваш проект.\n\n' +
        '🚀 Готовы начать?',
        mainMenu
    );
});

// 👉 Режим подачи заявки - теперь через bot.hears для reply-клавиатуры
bot.hears('📝 Оставить заявку', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    // Проверка, чтобы не запускать режим заявки повторно, если пользователь уже в нем
    if (waitingForApplication.has(userId)) {
         await ctx.reply('Вы уже в режиме подачи заявки. Опишите вашу задачу.', {
              reply_markup: { force_reply: true } // Повторно предлагаем force_reply, если нужно
         });
         return;
     }

    waitingForApplication.add(userId);
    // Для reply-клавиатуры не нужно answerCbQuery()
    await ctx.reply('✍️ Опишите вашу задачу, и мы предложим решение:', {
        reply_markup: {
            force_reply: true, // Telegram активирует поле ввода только сейчас
            // Можно добавить remove_keyboard: true, чтобы скрыть reply клавиатуру во время ввода заявки
        },
    });
});

// Middleware для ограничения ввода текста
bot.on('text', async (ctx, next) => {
    if (ctx.chat.type !== 'private') return next(); // Пропускаем группы

    const userId = ctx.from?.id;
    if (!userId) return next();

    // Если пользователь НЕ в режиме ожидания заявки, отправляем меню и останавливаем обработку
    if (!waitingForApplication.has(userId)) {
        await ctx.reply('❗️ Пожалуйста, используйте меню или кнопку для взаимодействия.', mainMenu);
        return; // Останавливаем обработку
    }

    // Если пользователь в режиме ожидания заявки, передаем управление следующему обработчику (текущему bot.on('text'))
    next();
});

// 🛑 Игнорим текст из групп
bot.on('text', async (ctx) => {
    if (ctx.chat.type !== 'private') return;

    const userId = ctx.from?.id;
    if (!userId) return;

    const now = Date.now();
    const last = userLastSubmission.get(userId);

    if (last && now - last < SUBMISSION_COOLDOWN) {
        const secondsLeft = Math.ceil((SUBMISSION_COOLDOWN - (now - last)) / 1000);
        await ctx.reply(`⏱ Подождите ${secondsLeft} сек. перед повторной отправкой.`);
        return;
    }

    const text = ctx.message?.text;
    if (!text) return;

    try {
        db.prepare(`
            INSERT INTO applications (user_id, username, application_text)
            VALUES (?, ?, ?)
        `).run(userId, ctx.from?.username || null, text);

        waitingForApplication.delete(userId);
        userLastSubmission.set(userId, now);

        // Отправляем сообщение о получении заявки и явно прикрепляем главное меню (Reply-клавиатуру)
        await ctx.reply('✅ Ваша заявка получена. Мы свяжемся с вами!', { reply_markup: mainMenu.reply_markup });

        const applicationMessage = `📨 Новая заявка от @${ctx.from?.username || 'пользователя'}:\n\n${text}`;
        try {
            await bot.telegram.sendMessage(GROUP_CHAT_ID as string, applicationMessage);
        } catch (err) {
            console.error('❌ Ошибка при отправке в группу:', err);
        }

        const rows = db.prepare('SELECT * FROM applications').all();
        console.log('📋 Текущие заявки:', rows);
    } catch (e) {
        console.error('❌ Ошибка SQLite:', e);
        await ctx.reply('❌ Ошибка при сохранении. Попробуйте позже.');
    }
});

(async () => {
    initDB();
    await bot.launch();
    console.log('🚀 Бот запущен');
})();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
