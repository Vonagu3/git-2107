-- PostgreSQL. Запускайте весь скрипт в одном соединении.
-- Временные таблицы доступны до закрытия соединения.
-- Повторный запуск пересоздаёт только временные учебные таблицы.
DROP TABLE IF EXISTS pg_temp.public_messages, pg_temp.messages, pg_temp.users CASCADE;

-- ДО: общая лента.
CREATE TEMP TABLE users (id integer PRIMARY KEY, nickname text NOT NULL);
CREATE TEMP TABLE messages (
    id integer PRIMARY KEY,
    author_id integer NOT NULL REFERENCES users(id),
    text text NOT NULL, sent_at timestamp NOT NULL
);
INSERT INTO users VALUES (7, 'Лис'), (9, 'Сова'), (10, 'Кот');
INSERT INTO messages VALUES (1, 7, 'Привет всем!', '2026-11-20 10:00');
SELECT * FROM messages;

-- ПОСЛЕ: публичную ленту сохраняем отдельно: получателя у неё нет.
ALTER TABLE messages RENAME TO public_messages;
CREATE TEMP TABLE messages (
    id integer PRIMARY KEY,
    sender_id integer NOT NULL REFERENCES users(id),
    recipient_id integer NOT NULL REFERENCES users(id),
    text text NOT NULL, sent_at timestamp NOT NULL
);
INSERT INTO messages VALUES
    (1, 7, 9, 'Привет!', '2026-11-20 12:00'),
    (2, 9, 7, 'Привет!', '2026-11-20 12:01'),
    (3, 7, 9, 'Как дела?', '2026-11-20 12:02');
-- Одна таблица users присоединяется дважды, с разными псевдонимами.
SELECT s.nickname AS sender, r.nickname AS recipient, m.text, m.sent_at
FROM messages m
JOIN users s ON s.id = m.sender_id
JOIN users r ON r.id = m.recipient_id
ORDER BY m.sent_at, m.id;
-- Три сообщения; Кот пока ни с кем не переписывался.
