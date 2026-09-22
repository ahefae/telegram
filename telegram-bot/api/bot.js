// schedule-service Telegram bot — Vercel Serverless Function (webhook)
//
// Команды:
//   /start [group_<id>]  — приветствие; если пришли по ссылке с сайта, группа
//                          выбирается автоматически
//   /addgroup Название    — создать новую группу и сразу выбрать её
//   /groups                — список существующих групп (кнопками) для выбора;
//                            при выборе бот сразу пишет, какая пара сейчас идёт
//   /today                  — расписание на сегодня для выбранной группы
//   /now                    — какая пара идёт прямо сейчас / когда следующая /
//                            что пары на сегодня закончились
//   /site                   — ссылка на сайт с расписанием
//
// Под сообщениями всегда есть постоянное меню (реплай-клавиатура) с теми же
// действиями кнопками — можно вообще не печатать команды руками.
//
// Работает через вебхук (Telegram сам присылает сюда обновления POST-запросом),
// поэтому бот доступен 24/7 без постоянно запущенного процесса.
// Как привязать вебхук — см. telegram-bot/SETUP.md.

const { createClient } = require("@supabase/supabase-js");

const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
// Ссылка на сайт с расписанием — можно переопределить переменной окружения SITE_URL в Vercel.
const SITE_URL = process.env.SITE_URL || "https://shedukl.vercel.app";

const sb =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

const DAY_NAMES_FULL = ["", "понедельник", "вторник", "среду", "четверг", "пятницу", "субботу"];

// Подписи кнопок постоянного меню — специально совпадают с текстом, который
// присылает Telegram при нажатии, поэтому их же ловим как обычные сообщения.
const BTN_NOW = "🕐 Сейчас";
const BTN_TODAY = "📅 Сегодня";
const BTN_GROUPS = "🔀 Сменить группу";
const BTN_SITE = "🌐 Сайт";

function jsDayToOur(jsDay) {
  // JS: 0=Вс..6=Сб -> 1=Пн..6=Сб, 7=Вс (пар нет)
  return jsDay === 0 ? 7 : jsDay;
}

// Часовой пояс, по которому считается расписание — можно переопределить
// переменной окружения TIMEZONE в Vercel (по умолчанию Казахстан, Алматы).
const TIMEZONE = process.env.TIMEZONE || "Asia/Almaty";

// Сервер Vercel работает в UTC, а расписание — по местному времени, поэтому
// "который час сейчас" нужно всегда считать через эту функцию, а не new Date()
// напрямую (иначе идёт расхождение на несколько часов, как в UTC-часовом поясе).
function nowInTimezone() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  const map = {};
  for (const p of parts) map[p.type] = p.value;

  const weekdayToJsDay = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const jsDay = weekdayToJsDay[map.weekday];
  // hour может прийти как "24" вместо "00" в некоторых окружениях — нормализуем.
  const hour = Number(map.hour) % 24;
  const minute = Number(map.minute);

  return { jsDay, minutes: hour * 60 + minute };
}
function toMinutes(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
function hhmm(t) {
  return t.slice(0, 5);
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---- Telegram API helpers ------------------------------------------------

async function tg(method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}
function sendMessage(chatId, text, extra = {}) {
  return tg("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", ...extra });
}
function answerCallback(callbackQueryId, text) {
  return tg("answerCallbackQuery", { callback_query_id: callbackQueryId, text });
}

// Постоянная клавиатура под полем ввода — есть всегда, не нужно помнить команды.
function mainMenu() {
  return {
    keyboard: [
      [{ text: BTN_NOW }, { text: BTN_TODAY }],
      [{ text: BTN_GROUPS }, { text: BTN_SITE }],
    ],
    resize_keyboard: true,
  };
}

// ---- Supabase helpers -----------------------------------------------------

async function getUserGroup(chatId) {
  const { data } = await sb.from("users").select("group_id").eq("chat_id", chatId).single();
  return data && data.group_id ? data.group_id : null;
}

async function setUserGroup(chatId, groupId) {
  await sb.from("users").upsert({ chat_id: chatId, group_id: groupId, updated_at: new Date().toISOString() });
}

async function listGroups() {
  const { data } = await sb.from("groups").select("*").order("name");
  return data || [];
}

async function getGroupById(groupId) {
  const { data } = await sb.from("groups").select("*").eq("id", groupId).single();
  return data || null;
}

async function createGroup(name) {
  return sb.from("groups").insert({ name }).select().single();
}

async function getScheduleForDay(groupId, dayOfWeek) {
  const { data, error } = await sb
    .from("schedule")
    .select("*")
    .eq("group_id", groupId)
    .eq("day_of_week", dayOfWeek)
    .order("lesson_number", { ascending: true });
  if (error) throw error;
  return data || [];
}

// ---- Общая логика "какая пара сейчас" (используется и /now, и при выборе группы) ----

async function buildNowText(groupId) {
  const { jsDay, minutes: nowMin } = nowInTimezone();
  const today = jsDayToOur(jsDay);
  if (today === 7) return "Сегодня воскресенье, пар нет 🎉";

  const lessons = (await getScheduleForDay(groupId, today)).sort(
    (a, b) => toMinutes(a.time_start) - toMinutes(b.time_start)
  );
  if (lessons.length === 0) return "На сегодня пар нет.";

  const current = lessons.find((l) => nowMin >= toMinutes(l.time_start) && nowMin < toMinutes(l.time_end));
  if (current) {
    return (
      `Сейчас идёт ${current.lesson_number} пара: ${escapeHtml(current.subject_name)} ` +
      `(${hhmm(current.time_start)}–${hhmm(current.time_end)})` +
      (current.room ? `, ауд. ${escapeHtml(current.room)}` : "")
    );
  }

  const next = lessons.find((l) => toMinutes(l.time_start) > nowMin);
  if (next) {
    return `Сейчас перемена. Следующая пара в ${hhmm(next.time_start)}: ${escapeHtml(next.subject_name)}`;
  }

  return "На сегодня все пары закончились ✅";
}

// ---- Command handlers -------------------------------------------------

async function handleStart(chatId, payload) {
  if (payload && payload.startsWith("group_")) {
    const groupId = payload.replace("group_", "");
    const group = await getGroupById(groupId);
    if (group) {
      await setUserGroup(chatId, group.id);
      const nowText = await buildNowText(group.id);
      return sendMessage(
        chatId,
        `Привет! Группа «${escapeHtml(group.name)}» выбрана автоматически (перешли с сайта).\n\n${nowText}`,
        { reply_markup: mainMenu() }
      );
    }
  }
  return sendMessage(
    chatId,
    "Привет! Я бот расписания занятий.\n\n" +
      "Выбери группу и смотри, какая пара идёт сейчас — кнопками снизу или командами:\n" +
      `${BTN_GROUPS} (/groups) — выбрать свою группу\n` +
      `${BTN_TODAY} (/today) — расписание на сегодня\n` +
      `${BTN_NOW} (/now) — какая пара сейчас\n` +
      `${BTN_SITE} (/site) — открыть сайт с расписанием\n` +
      "/addgroup Название — добавить новую группу",
    { reply_markup: mainMenu() }
  );
}

async function handleSite(chatId) {
  return sendMessage(chatId, "Расписание на сайте:", {
    reply_markup: {
      inline_keyboard: [[{ text: "🌐 Открыть сайт", url: SITE_URL }]],
    },
  });
}

async function handleAddGroup(chatId, text) {
  const name = text.replace(/^\/addgroup(@\w+)?/, "").trim();
  if (!name) {
    return sendMessage(chatId, "Использование: /addgroup Название_группы\nНапример: /addgroup ПО-33");
  }
  const { data, error } = await createGroup(name);
  if (error) {
    if (error.code === "23505") {
      return sendMessage(chatId, `Группа «${escapeHtml(name)}» уже существует. Выбери её командой /groups`);
    }
    return sendMessage(chatId, "Не получилось создать группу: " + error.message);
  }
  await setUserGroup(chatId, data.id);
  return sendMessage(
    chatId,
    `✅ Группа «${escapeHtml(name)}» создана и выбрана для этого чата.\n\n` +
      `Дальше добавь занятия в Supabase → таблица schedule, group_id = ${data.id} ` +
      `(или через сайт, если там есть форма добавления) — и /today, /now заработают.`,
    { reply_markup: mainMenu() }
  );
}

async function handleGroups(chatId) {
  const groups = await listGroups();
  if (groups.length === 0) {
    return sendMessage(chatId, "Групп пока нет. Создай первую: /addgroup Название");
  }
  const keyboard = groups.map((g) => [{ text: g.name, callback_data: `group_${g.id}` }]);
  return sendMessage(chatId, "Выбери свою группу:", { reply_markup: { inline_keyboard: keyboard } });
}

async function handleToday(chatId) {
  const groupId = await getUserGroup(chatId);
  if (!groupId) return sendMessage(chatId, `Сначала выбери группу: ${BTN_GROUPS} (/groups)`, { reply_markup: mainMenu() });

  const today = jsDayToOur(nowInTimezone().jsDay);
  if (today === 7) return sendMessage(chatId, "Сегодня воскресенье, пар нет 🎉", { reply_markup: mainMenu() });

  const lessons = await getScheduleForDay(groupId, today);
  if (lessons.length === 0) return sendMessage(chatId, `Сегодня (${DAY_NAMES_FULL[today]}) пар нет.`, { reply_markup: mainMenu() });

  const lines = lessons.map(
    (l) =>
      `${l.lesson_number}. ${hhmm(l.time_start)}–${hhmm(l.time_end)} — ${escapeHtml(l.subject_name)}` +
      (l.teacher ? `\n   ${escapeHtml(l.teacher)}` : "") +
      (l.room ? `, ауд. ${escapeHtml(l.room)}` : "")
  );
  return sendMessage(chatId, `Расписание на сегодня (${DAY_NAMES_FULL[today]}):\n\n${lines.join("\n\n")}`, {
    reply_markup: mainMenu(),
  });
}

async function handleNow(chatId) {
  const groupId = await getUserGroup(chatId);
  if (!groupId) return sendMessage(chatId, `Сначала выбери группу: ${BTN_GROUPS} (/groups)`, { reply_markup: mainMenu() });

  const text = await buildNowText(groupId);
  return sendMessage(chatId, text, { reply_markup: mainMenu() });
}

async function handleCallback(callbackQuery) {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data || "";

  if (data.startsWith("group_")) {
    const groupId = data.replace("group_", "");
    const group = await getGroupById(groupId);
    if (!group) {
      return answerCallback(callbackQuery.id, "Группа не найдена");
    }
    await setUserGroup(chatId, group.id);
    await answerCallback(callbackQuery.id, `Выбрано: ${group.name}`);
    // Сразу же сообщаем, какая пара сейчас идёт (или что пар нет/закончились) для этой группы.
    const nowText = await buildNowText(group.id);
    return sendMessage(chatId, `✅ Группа «${escapeHtml(group.name)}» выбрана.\n\n${nowText}`, {
      reply_markup: mainMenu(),
    });
  }

  return answerCallback(callbackQuery.id, "");
}

// ---- Vercel entry point -----------------------------------------------

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("Bot webhook active");
  }
  if (!BOT_TOKEN || !sb) {
    console.error("Не заданы переменные окружения BOT_TOKEN / SUPABASE_URL / SUPABASE_ANON_KEY");
    return res.status(200).json({ ok: false, error: "missing env vars" });
  }

  try {
    const update = req.body || {};

    if (update.callback_query) {
      await handleCallback(update.callback_query);
      return res.status(200).json({ ok: true });
    }

    if (update.message) {
      const chatId = update.message.chat.id;
      const text = (update.message.text || "").trim();

      if (text.startsWith("/start")) {
        await handleStart(chatId, text.split(" ")[1]);
      } else if (text.startsWith("/addgroup")) {
        await handleAddGroup(chatId, text);
      } else if (text === "/groups" || text === BTN_GROUPS) {
        await handleGroups(chatId);
      } else if (text === "/today" || text === BTN_TODAY) {
        await handleToday(chatId);
      } else if (text === "/now" || text === BTN_NOW) {
        await handleNow(chatId);
      } else if (text === "/site" || text === BTN_SITE) {
        await handleSite(chatId);
      } else if (text) {
        await sendMessage(chatId, "Не понимаю команду. Напиши /start, чтобы увидеть меню.", { reply_markup: mainMenu() });
      }
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    // Telegram всё равно ждёт 200, иначе будет повторять доставку апдейта
    return res.status(200).json({ ok: false, error: e.message });
  }
};
