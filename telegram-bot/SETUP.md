# Деплой Telegram-бота на Vercel (24/7, бесплатно)

Бот теперь работает через **webhook**, а не через постоянно запущенный процесс
(`node bot.js` больше не нужен). Telegram сам присылает сообщения на URL
`https://<ваш-проект>.vercel.app/api/bot`.

## 1. Создать отдельный проект на Vercel для бота

Сайт (`frontend/`) и бот (`telegram-bot/`) — это **два разных** проекта на Vercel
из одного репозитория (у каждого свой Root Directory).

1. vercel.com → New Project → импортировать тот же репозиторий `schedule-service`.
2. В настройках при импорте указать **Root Directory: `telegram-bot`**.
3. Deploy.

## 2. Переменные окружения

В новом проекте: Settings → Environment Variables, добавить:

| Имя | Значение |
|---|---|
| `BOT_TOKEN` | токен от @BotFather |
| `SUPABASE_URL` | Project URL из Supabase → Settings → API |
| `SUPABASE_ANON_KEY` | anon/publishable ключ оттуда же |

После добавления переменных сделайте **Redeploy** (Deployments → ⋯ → Redeploy),
чтобы функция их подхватила.

## 3. Обновить схему БД

Если таблицы уже созданы раньше — выполните в Supabase → SQL Editor
только новый кусок из `database/schema.sql` (таблица `users`), она нужна,
чтобы бот помнил выбранную группу для каждого чата:

```sql
create table if not exists users (
  chat_id    bigint primary key,
  group_id   bigint references groups(id) on delete set null,
  updated_at timestamptz not null default now()
);
```

## 4. Привязать webhook

Откройте в браузере (подставив свои значения):

```
https://api.telegram.org/bot<ВАШ_BOT_TOKEN>/setWebhook?url=https://<ВАШ_ПРОЕКТ_БОТА>.vercel.app/api/bot
```

Должно вернуться `{"ok":true,"result":true,"description":"Webhook was set"}`.

Проверить текущий webhook: `https://api.telegram.org/bot<ВАШ_BOT_TOKEN>/getWebhookInfo`

## 5. Проверка

В Telegram напишите боту `/start`, затем `/addgroup Тест`, `/today`.
Если группа новая — расписание будет пустым, пока вы не добавите строки
в таблицу `schedule` для этого `group_id` (через Supabase Table Editor).

## Команды бота

| Команда | Что делает |
|---|---|
| `/start` | приветствие. Если бот открыт по ссылке с сайта (`?start=group_<id>`) — сразу выбирает эту группу |
| `/addgroup Название` | создаёт новую группу и выбирает её для этого чата |
| `/groups` | список всех групп кнопками — выбрать свою |
| `/today` | расписание на сегодня для выбранной группы |
| `/now` | какая пара идёт прямо сейчас / когда следующая |

## Важно про безопасность

В исходном архиве в файле `.env` был настоящий `BOT_TOKEN`. Раз он оказался
в файле, который куда-то передавался — зайдите к **@BotFather** → `/mybots` →
выберите бота → **API Token** → **Revoke current token**, получите новый
и впишите его в переменные окружения Vercel (шаг 2). Старый токен станет
нерабочим, это нормально.
