-- PostgreSQL. Запускайте весь скрипт в одном соединении.
-- Временные таблицы доступны до закрытия соединения.
-- Повторный запуск сбрасывает временные учебные данные.
DROP TABLE IF EXISTS pg_temp.user_skins, pg_temp.skin_transfers, pg_temp.set_skins, pg_temp.skin_sets, pg_temp.skin_copies, pg_temp.skin_types, pg_temp.users CASCADE;

CREATE TEMP TABLE users (id integer PRIMARY KEY, nickname text NOT NULL);
CREATE TEMP TABLE skin_types (id integer PRIMARY KEY, name text NOT NULL, rarity text NOT NULL);
CREATE TEMP TABLE skin_copies (
    id integer PRIMARY KEY,
    skin_type_id integer NOT NULL REFERENCES skin_types(id),
    owner_id integer NOT NULL REFERENCES users(id), created_at timestamp NOT NULL
);
CREATE TEMP TABLE skin_sets (id integer PRIMARY KEY, name text NOT NULL);
CREATE TEMP TABLE set_skins (
    id integer PRIMARY KEY, set_id integer NOT NULL REFERENCES skin_sets(id),
    skin_type_id integer NOT NULL REFERENCES skin_types(id), UNIQUE (set_id, skin_type_id)
);
CREATE TEMP TABLE skin_transfers (
    id integer PRIMARY KEY, copy_id integer NOT NULL REFERENCES skin_copies(id),
    sender_id integer NOT NULL REFERENCES users(id),
    recipient_id integer NOT NULL REFERENCES users(id), transferred_at timestamp NOT NULL,
    CHECK (sender_id <> recipient_id)
);
INSERT INTO users VALUES (1, 'Лис'), (2, 'Сова'), (3, 'Кот');
INSERT INTO skin_types VALUES
    (20, 'Ледяной', 'редкий'), (21, 'Снежный', 'обычный'),
    (22, 'Звёздный', 'редкий'), (23, 'Песочный', 'обычный');
INSERT INTO skin_copies VALUES
    (100, 20, 1, '2026-11-01 12:00'), (101, 20, 1, '2026-11-02 12:00'),
    (102, 20, 2, '2026-11-03 12:00');
INSERT INTO skin_sets VALUES (10, 'Зима'), (11, 'Сияние');
INSERT INTO set_skins VALUES (1, 10, 20), (2, 10, 21), (3, 11, 20), (4, 11, 22);
-- Передача и возврат копии 100; начальное получение не записываем.
-- Для этих данных отправитель совпадает с владельцем перед каждой передачей.
BEGIN;
INSERT INTO skin_transfers VALUES (1, 100, 1, 2, '2026-11-20 12:00');
UPDATE skin_copies SET owner_id = 2 WHERE id = 100;
COMMIT;
BEGIN;
INSERT INTO skin_transfers VALUES (2, 100, 2, 1, '2026-11-21 12:00');
UPDATE skin_copies SET owner_id = 1 WHERE id = 100;
COMMIT;
-- Копии: Лис — 2, Сова — 1, Кот — 0.
SELECT u.nickname, count(c.id) AS copies
FROM users u LEFT JOIN skin_copies c ON c.owner_id = u.id
GROUP BY u.id, u.nickname ORDER BY u.id;
-- M:N: Ледяной входит в два набора; Песочный вне наборов.
SELECT t.name AS skin, s.name AS set_name
FROM skin_types t LEFT JOIN set_skins x ON x.skin_type_id = t.id
LEFT JOIN skin_sets s ON s.id = x.set_id ORDER BY t.id, s.id;
-- Одна users присоединяется дважды: отправитель и получатель.
SELECT x.copy_id, s.nickname AS sender, r.nickname AS recipient, x.transferred_at
FROM skin_transfers x JOIN users s ON s.id = x.sender_id
JOIN users r ON r.id = x.recipient_id ORDER BY x.transferred_at, x.id;
-- Копия 100 вернулась к Лису; её номер, тип и дата создания прежние.
SELECT c.*, u.nickname AS owner FROM skin_copies c
JOIN users u ON u.id = c.owner_id ORDER BY c.id;
