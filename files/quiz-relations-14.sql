-- PostgreSQL. Запускайте весь скрипт в одном соединении.
-- Временные таблицы доступны до закрытия соединения.
-- Повторный запуск сбрасывает временные учебные данные.
DROP TABLE IF EXISTS pg_temp.users_one_chat, pg_temp.invitations, pg_temp.chat_members, pg_temp.chats, pg_temp.users CASCADE;

CREATE TEMP TABLE users (id integer PRIMARY KEY, nickname text NOT NULL);
CREATE TEMP TABLE chats (id integer PRIMARY KEY, name text NOT NULL);
CREATE TEMP TABLE chat_members (
    id integer PRIMARY KEY, user_id integer NOT NULL REFERENCES users(id),
    chat_id integer NOT NULL REFERENCES chats(id), joined_at timestamp NOT NULL,
    role text NOT NULL, UNIQUE (user_id, chat_id)
);
CREATE TEMP TABLE invitations (
    id integer PRIMARY KEY, sender_id integer NOT NULL REFERENCES users(id),
    recipient_id integer NOT NULL REFERENCES users(id),
    chat_id integer NOT NULL REFERENCES chats(id), sent_at timestamp NOT NULL,
    status text NOT NULL CHECK (status IN ('ожидает', 'принято', 'отклонено')),
    CHECK (sender_id <> recipient_id)
);
INSERT INTO users VALUES (1, 'Лис'), (2, 'Сова'), (3, 'Кот'), (4, 'Волк');
INSERT INTO chats VALUES (10, 'Общий'), (11, 'Игры'), (12, 'Новый чат');
INSERT INTO chat_members VALUES
    (1, 1, 10, '2026-11-01 12:00', 'администратор'),
    (2, 2, 11, '2026-11-01 13:00', 'администратор');
-- Отказ, повторное приглашение и встречное приглашение в другой чат.
-- Все отправители уже состоят в соответствующих чатах.
INSERT INTO invitations VALUES
    (1, 1, 2, 10, '2026-11-20 12:00', 'отклонено'),
    (2, 1, 2, 10, '2026-11-21 12:00', 'ожидает'),
    (3, 2, 1, 11, '2026-11-21 13:00', 'ожидает'),
    (4, 1, 3, 10, '2026-11-21 14:00', 'ожидает');
BEGIN;
UPDATE invitations SET status = 'принято' WHERE id = 2;
INSERT INTO chat_members VALUES (3, 2, 10, '2026-11-21 12:05', 'участник');
COMMIT;
BEGIN;
UPDATE invitations SET status = 'принято' WHERE id = 3;
INSERT INTO chat_members VALUES (4, 1, 11, '2026-11-21 13:10', 'участник');
COMMIT;
-- Четыре участия: у Лиса и Совы по два чата и разные роли.
SELECT u.nickname, c.name, m.role, m.joined_at
FROM chat_members m JOIN users u ON u.id = m.user_id
JOIN chats c ON c.id = m.chat_id ORDER BY u.id, c.id;
-- Четыре события, включая отказ и повтор той же пары в тот же чат.
SELECT s.nickname AS sender, r.nickname AS recipient, c.name,
       i.sent_at, i.status
FROM invitations i JOIN users s ON s.id = i.sender_id
JOIN users r ON r.id = i.recipient_id JOIN chats c ON c.id = i.chat_id
ORDER BY i.id;
-- Кот получил приглашение, но ещё не вступил. Волк без приглашений и участия.
SELECT u.nickname FROM users u LEFT JOIN chat_members m ON m.user_id = u.id
WHERE m.id IS NULL ORDER BY u.id;
-- Новый чат пуст: количество участников 2, 2, 0.
SELECT c.name, count(m.id) AS members FROM chats c
LEFT JOIN chat_members m ON m.chat_id = c.id
GROUP BY c.id, c.name ORDER BY c.id;
-- Проверка правила отправителя: результат должен быть пустым.
SELECT i.id FROM invitations i LEFT JOIN chat_members m
ON m.user_id = i.sender_id AND m.chat_id = i.chat_id WHERE m.id IS NULL;
