-- PostgreSQL. Запускайте весь скрипт в одном соединении.
-- Временные таблицы доступны до закрытия соединения.
-- Повторный запуск пересоздаёт только временные учебные таблицы.
DROP TABLE IF EXISTS pg_temp.tournament_arenas, pg_temp.tournaments, pg_temp.arenas CASCADE;

-- ДО: одна арена на турнир.
CREATE TEMP TABLE arenas (id integer PRIMARY KEY, name text NOT NULL);
CREATE TEMP TABLE tournaments (
    id integer PRIMARY KEY, name text NOT NULL,
    arena_id integer NOT NULL REFERENCES arenas(id)
);
INSERT INTO arenas VALUES (1, 'Север'), (2, 'Юг');
INSERT INTO tournaments VALUES (1, 'Весенний кубок', 1), (2, 'Летний кубок', 1);
SELECT * FROM tournaments ORDER BY id;

-- ПОСЛЕ: переносим существующие связи в отдельную таблицу.
CREATE TEMP TABLE tournament_arenas (
    id integer PRIMARY KEY,
    tournament_id integer NOT NULL REFERENCES tournaments(id),
    arena_id integer NOT NULL REFERENCES arenas(id),
    UNIQUE (tournament_id, arena_id)
);
INSERT INTO tournament_arenas (id, tournament_id, arena_id)
SELECT id, id, arena_id FROM tournaments;
ALTER TABLE tournaments DROP COLUMN arena_id;
INSERT INTO tournament_arenas VALUES (3, 1, 2);
-- Три строки: Весенний кубок — Север и Юг; Летний кубок — Север.
SELECT t.name AS tournament, a.name AS arena
FROM tournament_arenas ta
JOIN tournaments t ON t.id = ta.tournament_id
JOIN arenas a ON a.id = ta.arena_id
ORDER BY t.id, a.id;
