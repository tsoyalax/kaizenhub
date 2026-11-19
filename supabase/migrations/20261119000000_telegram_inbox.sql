-- «Входящие» из Telegram: голосовые и текстовые посты подключённого канала попадают во «Входящие» приложения.
-- Как устроено:
--   1. В приложении человек нажимает «Подключить Telegram» — создаётся строка tg_links с одноразовым кодом (только своя).
--   2. Бот (админ канала) получает пост «/connect КОД» и привязывает канал: public.tg_link(…).
--   3. Голосовое из канала сервер (api/telegram.js) расшифровывает и кладёт текст функцией public.tg_drop(…)
--      в документ data/users/<владелец>/tgdrops/<id>. Приложение забирает его, Claude выделяет задачи, документ удаляется.
-- Сервер ходит в базу с публичным ключом, поэтому обе функции проверяют общий секрет из app_private.tg_config
-- (он же — переменная TG_DB_SECRET в Vercel). Секрет генерируется здесь; посмотреть его:
--   select value from app_private.tg_config where key = 'secret';

create table if not exists app_private.tg_config (
  key   text primary key,
  value text not null
);
insert into app_private.tg_config (key, value)
values ('secret', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;
alter table app_private.tg_config enable row level security;   -- без политик: читают только функции базы

create table if not exists public.tg_links (
  token      text primary key default replace(gen_random_uuid()::text, '-', ''),
  owner      uuid not null default auth.uid(),
  chat_id    bigint unique,
  chat_title text,
  kind       text not null default 'info' check (kind in ('info', 'it')),
  pid        text,
  created_at timestamptz not null default now()
);
alter table public.tg_links enable row level security;
drop policy if exists tg_links_own on public.tg_links;
create policy tg_links_own on public.tg_links for all to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());
grant select, insert, delete on public.tg_links to authenticated;

-- новый код подключения (старые неподключённые коды того же человека убираем)
create or replace function public.tg_link_new(p_kind text default 'info', p_pid text default null) returns text
language plpgsql security invoker set search_path = public as $$
declare t text;
begin
  if auth.uid() is null then raise exception 'not_granted' using errcode = '42501'; end if;
  delete from public.tg_links where owner = auth.uid() and chat_id is null;
  insert into public.tg_links (kind, pid) values (coalesce(p_kind, 'info'), p_pid) returning token into t;
  return t;
end $$;
grant execute on function public.tg_link_new(text, text) to authenticated;

-- мои подключённые каналы
create or replace function public.tg_links_mine() returns table (token text, chat_id bigint, chat_title text, kind text, pid text)
language sql stable security invoker set search_path = public as $$
  select token, chat_id, chat_title, kind, pid from public.tg_links where owner = auth.uid() order by created_at;
$$;
grant execute on function public.tg_links_mine() to authenticated;

-- сервер: привязать канал к коду (пост «/connect КОД» в канале)
create or replace function public.tg_link(p_secret text, p_token text, p_chat bigint, p_title text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if p_secret is null or p_secret <> (select value from app_private.tg_config where key = 'secret') then
    raise exception 'not_granted' using errcode = '42501';
  end if;
  delete from public.tg_links where chat_id = p_chat and token <> p_token;   -- канал переподключили на другой код
  update public.tg_links set chat_id = p_chat, chat_title = left(p_title, 200) where token = p_token;
  return found;
end $$;

-- сервер: текст (расшифровка голосового или пост) — во «Входящие» владельца канала
create or replace function public.tg_drop(p_secret text, p_chat bigint, p_text text) returns boolean
language plpgsql security definer set search_path = public as $$
declare l public.tg_links; id text := replace(gen_random_uuid()::text, '-', ''); p text;
begin
  if p_secret is null or p_secret <> (select value from app_private.tg_config where key = 'secret') then
    raise exception 'not_granted' using errcode = '42501';
  end if;
  select * into l from public.tg_links where chat_id = p_chat;
  if not found or coalesce(btrim(p_text), '') = '' then return false; end if;
  p := 'data/users/' || l.owner::text || '/tgdrops/' || id;
  insert into public.docs (path, data)
  values (p, jsonb_build_object('text', left(p_text, 20000), 'kind', l.kind, 'pid', l.pid, 'chat', l.chat_title, 'at', now()));
  return true;
end $$;
revoke all on function public.tg_link(text, text, bigint, text) from public;
revoke all on function public.tg_drop(text, bigint, text) from public;
grant execute on function public.tg_link(text, text, bigint, text) to anon, authenticated;
grant execute on function public.tg_drop(text, bigint, text) to anon, authenticated;
