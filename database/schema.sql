-- schedule-service: схема БД + тестовые данные группы ПО-33
-- Выполнить целиком в Supabase → SQL Editor

-- === Таблицы ===================================================

create table if not exists groups (
  id   bigint generated always as identity primary key,
  name text not null unique
);

-- Привязка Telegram-чата к выбранной им группе (для /addgroup, /groups, /today, /now)
create table if not exists users (
  chat_id    bigint primary key,
  group_id   bigint references groups(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists schedule (
  id             bigint generated always as identity primary key,
  group_id       bigint not null references groups(id) on delete cascade,
  day_of_week    smallint not null check (day_of_week between 1 and 6), -- 1=Пн ... 6=Сб
  lesson_number  smallint not null,
  subject_name   text not null,
  teacher        text,
  room           text,
  time_start     time not null,
  time_end       time not null
);

-- === Группа ======================================================

insert into groups (name) values ('ПО-33')
on conflict (name) do nothing;

-- === Расписание ПО-33 ============================================
-- Время пар взято из официального расписания звонков колледжа:
--   Обычные дни (Вт-Сб): 1) 08:30-10:00  2) 10:10-11:40  3) 12:20-13:50
--                        4) 14:00-15:30  5) 15:40-17:10
--   Понедельник (с кураторским часом): 1) 08:30-09:50  куратор.час 10:00-10:30
--                        2) 10:40-12:00 3) 12:40-14:00  4) 14:10-15:30  5) 15:40-17:00

with g as (select id from groups where name = 'ПО-33')
insert into schedule (group_id, day_of_week, lesson_number, subject_name, teacher, room, time_start, time_end)
values
-- Понедельник (1) — расписание с кураторским часом
((select id from g), 1, 2, 'ПМ6 Проектирование и выполнение по созданию и модификации Web-ресурсов', 'Тукубаев А.С.', '117', '10:40', '12:00'),
((select id from g), 1, 3, 'ПМ6 Проектирование и выполнение по созданию и модификации Web-ресурсов', 'Тукубаев А.С.', '117', '12:40', '14:00'),
((select id from g), 1, 4, 'ПМ5 Рефакторинг программного кода',                                    'Константинов Р.А.', '107а', '14:10', '15:30'),
((select id from g), 1, 5, 'ПМ5 Рефакторинг программного кода',                                    'Константинов Р.А.', '107а', '15:40', '17:00'),

-- Вторник (2) — обычное расписание
((select id from g), 2, 2, 'ПМ6 Проектирование и выполнение по созданию и модификации Web-ресурсов', 'Тукубаев А.С.', '117', '10:10', '11:40'),
((select id from g), 2, 3, 'ПМ6 Проектирование и выполнение по созданию и модификации Web-ресурсов', 'Тукубаев А.С.', '117', '12:20', '13:50'),
((select id from g), 2, 4, 'ПМ6 Проектирование и выполнение по созданию и модификации Web-ресурсов', 'Тукубаев А.С.', '117', '14:00', '15:30'),
((select id from g), 2, 5, 'ПМ5 Рефакторинг программного кода',                                    'Константинов Р.А.', '107а', '15:40', '17:10'),

-- Среда (3) — обычное расписание
((select id from g), 3, 1, 'РО5.4 Выполнять рефакторинг программного кода / Физическая культура (по подгруппам)', 'Лазорская Е.В. / Коломиец В.С.', '115', '08:30', '10:00'),
((select id from g), 3, 2, 'ПМ6 Проектирование и выполнение по созданию и модификации Web-ресурсов', 'Тукубаев А.С.', '117', '10:10', '11:40'),
((select id from g), 3, 3, 'ПМ5 Рефакторинг программного кода',                                    'Константинов Р.А.', '107а', '12:20', '13:50'),
((select id from g), 3, 4, 'ООМ4 Применение основ социальных наук',                                 'Злочевская С.В.', '321', '14:00', '15:30'),

-- Четверг (4) — обычное расписание
((select id from g), 4, 1, 'Физическая культура', 'Коломиец В.С.', null, '08:30', '10:00'),
((select id from g), 4, 2, 'ООМ4 Применение основ социальных наук', 'Злочевская С.В.', '321', '10:10', '11:40'),

-- Пятница (5) — обычное расписание
((select id from g), 5, 1, 'ПМ6 Проектирование и выполнение по созданию и модификации Web-ресурсов', 'Тукубаев А.С.', '117', '08:30', '10:00'),
((select id from g), 5, 2, 'Физическая культура', 'Коломиец В.С.', null, '10:10', '11:40'),
((select id from g), 5, 3, 'РО5.4 Выполнять рефакторинг программного кода', 'Лазорская Е.В.', '115', '12:20', '13:50'),
((select id from g), 5, 4, 'РО5.4 Выполнять рефакторинг программного кода / ПМ5 Рефакторинг программного кода (по подгруппам)', 'Лазорская Е.В. / Константинов Р.А.', '115/107а', '14:00', '15:30');

-- Проверка:
-- select day_of_week, lesson_number, subject_name, time_start, time_end
-- from schedule join groups on groups.id = schedule.group_id
-- where groups.name = 'ПО-33' order by day_of_week, lesson_number;
