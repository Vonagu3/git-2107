-- PostgreSQL. Запускайте весь скрипт в одном соединении.
-- Временные таблицы доступны до закрытия соединения.
-- Повторный запуск пересоздаёт только временные учебные таблицы.
DROP TABLE IF EXISTS pg_temp.user_skins, pg_temp.skins, pg_temp.users CASCADE;

CREATE TEMP TABLE users (id integer PRIMARY KEY, nickname text NOT NULL);
CREATE TEMP TABLE skins (id integer PRIMARY KEY, name text NOT NULL, rarity text NOT NULL);
CREATE TEMP TABLE user_skins (
    id integer PRIMARY KEY,
    user_id integer NOT NULL REFERENCES users(id),
    skin_id integer NOT NULL REFERENCES skins(id),
    quantity integer NOT NULL CHECK (quantity > 0),
    first_received_at date NOT NULL,
    UNIQUE (user_id, skin_id)
);
INSERT INTO users VALUES (1, 'Лис'), (2, 'Сова'), (3, 'Кот');
INSERT INTO skins VALUES (20, 'Ледяной', 'редкий'), (21, 'Огненный', 'обычный');
INSERT INTO user_skins VALUES
    (1, 1, 20, 3, '2026-10-01'),
    (2, 2, 20, 1, '2026-11-10'),
    (3, 1, 21, 2, '2026-11-12');
-- Один тип скина у двух пользователей: разные количество и дата.
-- У Кота коллекция пуста, поля владения NULL.
SELECT u.nickname, s.name, s.rarity, x.quantity, x.first_received_at
FROM users u
LEFT JOIN user_skins x ON x.user_id = u.id
LEFT JOIN skins s ON s.id = x.skin_id
ORDER BY u.id, s.id;
