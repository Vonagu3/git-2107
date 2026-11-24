-- Урок 17. Только для отдельного учебного проекта Supabase с вымышленными данными.
-- Создаёт состояние после урока 16 и домашки про модераторов.
-- Не удаляет и не переиспользует существующие одноимённые таблицы.
-- Запускать целиком в SQL Editor один раз. При конфликте вся транзакция откатится.
begin;

do $$
begin
  if to_regclass('public.users') is not null
     or to_regclass('public.chats') is not null
     or to_regclass('public.chat_members') is not null
     or to_regclass('public.invitations') is not null then
    raise exception 'Таблицы урока уже существуют. Используйте отдельный пустой учебный проект; данные не изменены.';
  end if;
end $$;

create table public.users (
  id integer primary key,
  nickname text not null,
  constraint users_nickname_not_empty check (nickname <> '')
);

create table public.chats (
  id integer primary key,
  name text not null,
  description text
);

create table public.chat_members (
  id integer primary key,
  user_id integer not null references public.users(id),
  chat_id integer not null references public.chats(id),
  joined_at timestamp not null,
  role text not null,
  unique (user_id, chat_id),
  constraint chat_members_role_check
    check (role in ('администратор', 'участник', 'модератор'))
);

create table public.invitations (
  id integer primary key,
  sender_id integer not null references public.users(id),
  recipient_id integer not null references public.users(id),
  chat_id integer not null references public.chats(id),
  sent_at timestamp not null,
  status text not null default 'ожидает'
    check (status in ('ожидает', 'принято', 'отклонено')),
  check (sender_id <> recipient_id)
);

insert into public.users (id, nickname) values
  (1, 'Лис'), (2, 'Сова'), (3, 'Кот'), (4, 'Волк');
insert into public.chats (id, name, description) values
  (10, 'Общий', 'Общение участников'), (11, 'Игры', null), (12, 'Новый чат', null);
insert into public.chat_members (id, user_id, chat_id, joined_at, role) values
  (1, 1, 10, '2026-11-01 12:00', 'администратор'),
  (2, 2, 11, '2026-11-01 13:00', 'администратор'),
  (3, 2, 10, '2026-11-21 12:05', 'модератор'),
  (4, 1, 11, '2026-11-21 13:10', 'участник');
insert into public.invitations (id, sender_id, recipient_id, chat_id, sent_at, status) values
  (1, 1, 2, 10, '2026-11-20 12:00', 'отклонено'),
  (2, 1, 2, 10, '2026-11-21 12:00', 'принято'),
  (3, 2, 1, 11, '2026-11-21 13:00', 'принято'),
  (4, 1, 3, 10, '2026-11-21 14:00', 'ожидает');

alter table public.users enable row level security;
alter table public.chats enable row level security;
alter table public.chat_members enable row level security;
alter table public.invitations enable row level security;

-- Права относятся только к четырём новым учебным таблицам.
revoke all on table public.users, public.chats, public.chat_members, public.invitations
  from public, anon, authenticated;
grant usage on schema public to anon;
grant select on table public.users, public.chats, public.chat_members, public.invitations to anon;
grant insert, update, delete on table public.users to anon;

-- Открытые политики нужны только для этого изолированного упражнения.
-- Любой обладатель publishable key проекта сможет менять учебных users.
create policy lesson17_users_select on public.users for select to anon using (true);
create policy lesson17_users_insert on public.users for insert to anon with check (true);
create policy lesson17_users_update on public.users for update to anon using (true) with check (true);
create policy lesson17_users_delete on public.users for delete to anon using (true);
create policy lesson17_chats_select on public.chats for select to anon using (true);
create policy lesson17_members_select on public.chat_members for select to anon using (true);
create policy lesson17_invitations_select on public.invitations for select to anon using (true);

notify pgrst, 'reload schema';
commit;

select 'users' as table_name, count(*) as rows from public.users
union all select 'chats', count(*) from public.chats
union all select 'chat_members', count(*) from public.chat_members
union all select 'invitations', count(*) from public.invitations;
