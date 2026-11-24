-- PostgreSQL. Постоянные таблицы сохраняются после закрытия соединения.
-- ВНИМАНИЕ: повторный запуск удаляет эти четыре таблицы и их данные.
-- public. отличает их от одноимённых временных таблиц.
DROP TABLE IF EXISTS public.invitations, public.chat_members, public.chats, public.users;

CREATE TABLE public.users (id integer PRIMARY KEY, nickname text NOT NULL);
CREATE TABLE public.chats (id integer PRIMARY KEY, name text NOT NULL);
CREATE TABLE public.chat_members (
    id integer PRIMARY KEY, user_id integer NOT NULL REFERENCES public.users(id),
    chat_id integer NOT NULL REFERENCES public.chats(id), joined_at timestamp NOT NULL,
    role text NOT NULL, UNIQUE (user_id, chat_id)
);
CREATE TABLE public.invitations (
    id integer PRIMARY KEY, sender_id integer NOT NULL REFERENCES public.users(id),
    recipient_id integer NOT NULL REFERENCES public.users(id),
    chat_id integer NOT NULL REFERENCES public.chats(id), sent_at timestamp NOT NULL,
    status text NOT NULL CHECK (status IN ('ожидает', 'принято', 'отклонено')),
    CHECK (sender_id <> recipient_id)
);
INSERT INTO public.users VALUES (1, 'Лис'), (2, 'Сова'), (3, 'Кот'), (4, 'Волк');
INSERT INTO public.chats VALUES (10, 'Общий'), (11, 'Игры'), (12, 'Новый чат');
INSERT INTO public.chat_members VALUES
    (1, 1, 10, '2026-11-01 12:00', 'администратор'),
    (2, 2, 11, '2026-11-01 13:00', 'администратор');
-- Отказ, повторное приглашение и встречное приглашение в другой чат.
-- Все отправители уже состоят в соответствующих чатах.
INSERT INTO public.invitations VALUES
    (1, 1, 2, 10, '2026-11-20 12:00', 'отклонено'),
    (2, 1, 2, 10, '2026-11-21 12:00', 'ожидает'),
    (3, 2, 1, 11, '2026-11-21 13:00', 'ожидает'),
    (4, 1, 3, 10, '2026-11-21 14:00', 'ожидает');
BEGIN;
UPDATE public.invitations SET status = 'принято' WHERE id = 2;
INSERT INTO public.chat_members VALUES (3, 2, 10, '2026-11-21 12:05', 'участник');
COMMIT;
BEGIN;
UPDATE public.invitations SET status = 'принято' WHERE id = 3;
INSERT INTO public.chat_members VALUES (4, 1, 11, '2026-11-21 13:10', 'участник');
COMMIT;
