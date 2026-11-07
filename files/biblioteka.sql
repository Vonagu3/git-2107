-- Занятие 14 · домашка: школьная библиотека
-- Скопируйте ВЕСЬ текст в SQL Editor и нажмите Run. Повторный запуск начинает всё заново.

drop table if exists vydachi;
drop table if exists knigi_avtory;
drop table if exists knigi;
drop table if exists avtory;
drop table if exists chitateli;

create table avtory (
  id   bigint generated always as identity primary key,
  imya text not null
);

create table knigi (
  id       bigint generated always as identity primary key,
  nazvanie text not null,
  god      int
);

-- связка «многие ко многим»: у книги может быть несколько авторов, у автора — много книг
create table knigi_avtory (
  id        bigint generated always as identity primary key,
  kniga_id  bigint not null references knigi(id),
  avtor_id  bigint not null references avtory(id)
);

create table chitateli (
  id    bigint generated always as identity primary key,
  imya  text not null,
  klass text not null
);

-- выдача: какая книга, какому читателю, когда взял и когда вернул (пусто — ещё на руках)
create table vydachi (
  id            bigint generated always as identity primary key,
  kniga_id      bigint not null references knigi(id),
  chitatel_id   bigint not null references chitateli(id),
  data_vydachi  date   not null,
  data_vozvrata date
);

alter table avtory enable row level security;
alter table knigi enable row level security;
alter table knigi_avtory enable row level security;
alter table chitateli enable row level security;
alter table vydachi enable row level security;

insert into avtory (imya) values
  ('Пушкин'), ('Толстой'), ('Ильф'), ('Петров'), ('Носов');

insert into knigi (nazvanie, god) values
  ('Капитанская дочка',       1836),
  ('Война и мир',             1869),
  ('Двенадцать стульев',      1928),
  ('Золотой телёнок',         1931),
  ('Незнайка на Луне',        1965),
  ('Сказка о рыбаке и рыбке', 1835),
  ('Энциклопедия школьника',  2020);

insert into knigi_avtory (kniga_id, avtor_id) values
  (1, 1), (2, 2), (3, 3), (3, 4), (4, 3), (4, 4), (5, 5), (6, 1);

insert into chitateli (imya, klass) values
  ('Аня', '7И'), ('Боря', '7И'), ('Вика', '8А'), ('Гоша', '8А'), ('Дина', '7И');

insert into vydachi (kniga_id, chitatel_id, data_vydachi, data_vozvrata) values
  (3, 1, '2026-10-01', '2026-10-15'),
  (5, 1, '2026-10-20', NULL),
  (1, 2, '2026-10-05', '2026-10-25'),
  (2, 3, '2026-09-15', NULL),
  (4, 2, '2026-10-28', NULL),
  (6, 4, '2026-11-01', '2026-11-03'),
  (3, 4, '2026-11-02', NULL);

select (select count(*) from knigi) as knig, (select count(*) from vydachi) as vydach;   -- должно быть 7 и 7
