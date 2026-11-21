-- PostgreSQL. Запускайте весь скрипт в одном соединении.
-- Временные таблицы доступны до закрытия соединения.
-- Повторный запуск пересоздаёт только временные учебные таблицы.
DROP TABLE IF EXISTS pg_temp.users_one_chat, pg_temp.chat_members, pg_temp.users, pg_temp.chats CASCADE;

-- ВАРИАНТ 1:N: у каждого пользователя один чат.
CREATE TEMP TABLE chats (id integer PRIMARY KEY, name text NOT NULL);
CREATE TEMP TABLE users (
    id integer PRIMARY KEY, nickname text NOT NULL,
    chat_id integer NOT NULL REFERENCES chats(id)
);
INSERT INTO chats VALUES (10, 'Общий'), (11, 'Игры'), (12, 'Новый чат');
INSERT INTO users VALUES (1, 'Лис', 10), (2, 'Сова', 10);
SELECT u.nickname, c.name FROM users u JOIN chats c ON c.id = u.chat_id ORDER BY u.id;

-- ВАРИАНТ M:N: отдельный набор данных для групповых чатов.
-- Старую таблицу оставляем для сравнения двух моделей.
ALTER TABLE users RENAME TO users_one_chat;
CREATE TEMP TABLE users (id integer PRIMARY KEY, nickname text NOT NULL);
CREATE TEMP TABLE chat_members (
    id integer PRIMARY KEY,
    user_id integer NOT NULL REFERENCES users(id),
    chat_id integer NOT NULL REFERENCES chats(id),
    joined_at timestamp NOT NULL,
    UNIQUE (user_id, chat_id)
);
INSERT INTO users VALUES (1, 'Лис'), (2, 'Сова'), (3, 'Кот');
INSERT INTO chat_members VALUES
    (1, 1, 10, '2026-11-20 12:00'),
    (2, 1, 11, '2026-11-21 15:00'),
    (3, 2, 10, '2026-11-20 13:00');
-- Три участия; дата относится к конкретной паре пользователь–чат.
SELECT u.nickname, c.name, m.joined_at
FROM chat_members m
JOIN users u ON u.id = m.user_id
JOIN chats c ON c.id = m.chat_id
ORDER BY u.id, c.id;
-- Пользователь без чатов: Кот.
SELECT u.nickname FROM users u
LEFT JOIN chat_members m ON m.user_id = u.id WHERE m.id IS NULL;
-- Чат без участников: Новый чат.
SELECT c.name FROM chats c
LEFT JOIN chat_members m ON m.chat_id = c.id WHERE m.id IS NULL;
