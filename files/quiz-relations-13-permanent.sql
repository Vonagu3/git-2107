-- PostgreSQL. Постоянные таблицы сохраняются после закрытия соединения.
-- ВНИМАНИЕ: повторный запуск удаляет эти шесть таблиц и их данные.
-- public. отличает их от одноимённых временных таблиц.
DROP TABLE IF EXISTS public.skin_transfers;
DROP TABLE IF EXISTS public.skin_copies;
DROP TABLE IF EXISTS public.set_skins;
DROP TABLE IF EXISTS public.skin_sets;
DROP TABLE IF EXISTS public.skin_types;
DROP TABLE IF EXISTS public.users;

CREATE TABLE public.users (id integer PRIMARY KEY, nickname text NOT NULL);
CREATE TABLE public.skin_types (id integer PRIMARY KEY, name text NOT NULL, rarity text NOT NULL);
CREATE TABLE public.skin_sets (id integer PRIMARY KEY, name text NOT NULL);
CREATE TABLE public.set_skins (
    id integer PRIMARY KEY, set_id integer NOT NULL REFERENCES public.skin_sets(id),
    skin_type_id integer NOT NULL REFERENCES public.skin_types(id), UNIQUE (set_id, skin_type_id)
);
CREATE TABLE public.skin_copies (
    id integer PRIMARY KEY,
    set_skin_id integer NOT NULL REFERENCES public.set_skins(id),
    owner_id integer NOT NULL REFERENCES public.users(id), created_at timestamp NOT NULL
);
CREATE TABLE public.skin_transfers (
    id integer PRIMARY KEY, copy_id integer NOT NULL REFERENCES public.skin_copies(id),
    sender_id integer NOT NULL REFERENCES public.users(id),
    recipient_id integer NOT NULL REFERENCES public.users(id), transferred_at timestamp NOT NULL,
    CHECK (sender_id <> recipient_id)
);
INSERT INTO public.users VALUES (1, 'Лис'), (2, 'Сова'), (3, 'Кот');
INSERT INTO public.skin_types VALUES
    (20, 'Ледяной', 'редкий'), (21, 'Снежный', 'обычный'),
    (22, 'Звёздный', 'редкий');
INSERT INTO public.skin_sets VALUES (10, 'Зима'), (11, 'Сияние');
INSERT INTO public.set_skins VALUES (1, 10, 20), (2, 10, 21), (3, 11, 20), (4, 11, 22);
-- set_skin_id 1 — Ледяной из Зимы; 3 — Ледяной из Сияния.
INSERT INTO public.skin_copies VALUES
    (100, 1, 1, '2026-11-01 12:00'), (101, 1, 1, '2026-11-02 12:00'),
    (102, 1, 2, '2026-11-03 12:00'), (103, 3, 1, '2026-11-04 12:00');
-- Передача и возврат копии 100; начальное получение не записываем.
-- Для этих данных отправитель совпадает с владельцем перед каждой передачей.
BEGIN;
INSERT INTO public.skin_transfers VALUES (1, 100, 1, 2, '2026-11-20 12:00');
UPDATE public.skin_copies SET owner_id = 2 WHERE id = 100;
COMMIT;
BEGIN;
INSERT INTO public.skin_transfers VALUES (2, 100, 2, 1, '2026-11-21 12:00');
UPDATE public.skin_copies SET owner_id = 1 WHERE id = 100;
COMMIT;
-- Копии: Лис — 3, Сова — 1, Кот — 0.
SELECT u.nickname, count(c.id) AS copies
FROM public.users u LEFT JOIN public.skin_copies c ON c.owner_id = u.id
GROUP BY u.id, u.nickname ORDER BY u.id;
-- M:N: Ледяной входит в два набора; в каждом наборе два типа.
SELECT t.name AS skin, s.name AS set_name
FROM public.skin_types t LEFT JOIN public.set_skins x ON x.skin_type_id = t.id
LEFT JOIN public.skin_sets s ON s.id = x.set_id ORDER BY t.id, s.id;
-- Одна users присоединяется дважды: отправитель и получатель.
SELECT x.copy_id, s.nickname AS sender, r.nickname AS recipient, x.transferred_at
FROM public.skin_transfers x JOIN public.users s ON s.id = x.sender_id
JOIN public.users r ON r.id = x.recipient_id ORDER BY x.transferred_at, x.id;
-- Копия 100 вернулась к Лису; её номер, тип, набор и дата создания прежние.
SELECT c.id, t.name AS skin, s.name AS set_name, u.nickname AS owner, c.created_at
FROM public.skin_copies c
JOIN public.set_skins x ON x.id = c.set_skin_id
JOIN public.skin_types t ON t.id = x.skin_type_id
JOIN public.skin_sets s ON s.id = x.set_id
JOIN public.users u ON u.id = c.owner_id ORDER BY c.id;
-- Количество копий по типу и набору: Ледяной/Зима — 3,
-- Ледяной/Сияние — 1, Снежный/Зима и Звёздный/Сияние — 0.
SELECT t.name AS skin, s.name AS set_name, count(c.id) AS copies
FROM public.set_skins x
JOIN public.skin_types t ON t.id = x.skin_type_id
JOIN public.skin_sets s ON s.id = x.set_id
LEFT JOIN public.skin_copies c ON c.set_skin_id = x.id
GROUP BY x.id, t.name, s.name ORDER BY x.id;
