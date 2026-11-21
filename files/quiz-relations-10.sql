-- PostgreSQL. Запускайте весь скрипт в одном соединении.
-- Временные таблицы доступны до закрытия соединения.
-- Повторный запуск пересоздаёт только временные учебные таблицы.
DROP TABLE IF EXISTS pg_temp.transfers, pg_temp.items, pg_temp.players CASCADE;

-- ДО: отдельные экземпляры предметов и их текущие владельцы.
CREATE TEMP TABLE players (id integer PRIMARY KEY, nickname text NOT NULL);
CREATE TEMP TABLE items (
    id integer PRIMARY KEY, name text NOT NULL,
    owner_id integer NOT NULL REFERENCES players(id)
);
INSERT INTO players VALUES (1, 'Лис'), (2, 'Сова');
INSERT INTO items VALUES (10, 'Меч', 1), (11, 'Щит', 2);
SELECT * FROM items ORDER BY id;

-- ПОСЛЕ: история передач. Начальное получение сюда не записываем.
CREATE TEMP TABLE transfers (
    id integer PRIMARY KEY,
    item_id integer NOT NULL REFERENCES items(id),
    sender_id integer NOT NULL REFERENCES players(id),
    recipient_id integer NOT NULL REFERENCES players(id),
    transferred_at timestamp NOT NULL,
    CHECK (sender_id <> recipient_id)
);
-- Каждую передачу и смену владельца выполняем вместе.
BEGIN;
INSERT INTO transfers VALUES (1, 10, 1, 2, '2026-11-20 12:00');
UPDATE items SET owner_id = 2 WHERE id = 10;
COMMIT;
BEGIN;
INSERT INTO transfers VALUES (2, 10, 2, 1, '2026-11-20 13:00');
UPDATE items SET owner_id = 1 WHERE id = 10;
COMMIT;
-- Две передачи меча: Лис → Сова, затем Сова → Лис.
SELECT i.name, s.nickname AS sender, r.nickname AS recipient, t.transferred_at
FROM transfers t
JOIN items i ON i.id = t.item_id
JOIN players s ON s.id = t.sender_id
JOIN players r ON r.id = t.recipient_id
ORDER BY t.transferred_at, t.id;
-- Текущий владелец меча — Лис; у щита передач нет.
SELECT i.name, p.nickname AS owner
FROM items i JOIN players p ON p.id = i.owner_id ORDER BY i.id;
-- FK проверяет существование игроков, но не совпадение отправителя
-- с текущим владельцем: в приложении это отдельная проверка.
