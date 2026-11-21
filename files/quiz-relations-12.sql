-- PostgreSQL. Запускайте весь скрипт в одном соединении.
-- Временные таблицы доступны до закрытия соединения.
-- Повторный запуск пересоздаёт только временные учебные таблицы.
DROP TABLE IF EXISTS pg_temp.participations, pg_temp.raids, pg_temp.players CASCADE;

CREATE TEMP TABLE players (id integer PRIMARY KEY, nickname text NOT NULL);
CREATE TEMP TABLE raids (id integer PRIMARY KEY, starts_at timestamp NOT NULL);
CREATE TEMP TABLE participations (
    id integer PRIMARY KEY,
    player_id integer NOT NULL REFERENCES players(id),
    raid_id integer NOT NULL REFERENCES raids(id),
    role text NOT NULL, confirmation_status text NOT NULL,
    UNIQUE (player_id, raid_id)
);
INSERT INTO players VALUES (1, 'Лис'), (2, 'Сова');
INSERT INTO raids VALUES
    (10, '2026-11-21 18:00'), (11, '2026-11-22 18:00'), (12, '2026-11-23 18:00');
INSERT INTO participations VALUES
    (1, 1, 10, 'лекарь', 'подтверждено'),
    (2, 1, 11, 'танк', 'ожидает'),
    (3, 2, 10, 'танк', 'подтверждено');
-- Лис в двух рейдах с разными ролями. У пустого рейда 12 поля участия NULL.
SELECT r.id AS raid, r.starts_at, p.nickname, x.role, x.confirmation_status
FROM raids r
LEFT JOIN participations x ON x.raid_id = r.id
LEFT JOIN players p ON p.id = x.player_id
ORDER BY r.id, p.id;
-- Число участников: 10 → 2, 11 → 1, 12 → 0.
SELECT r.id, count(x.id) AS participants
FROM raids r LEFT JOIN participations x ON x.raid_id = r.id
GROUP BY r.id ORDER BY r.id;
