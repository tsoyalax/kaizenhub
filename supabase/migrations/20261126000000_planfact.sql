-- План-факт роликов в боте Kaizen AI.
--   • Сводку (план по неделям и публикации по дням) раз в день присылает Claude с компьютера владельца: public.pf_put(…).
--     Владелец определяется по почте его аккаунта KaizenHub.
--   • Бот на вопрос «какой план-факт?» читает сводку владельца своего чата: public.pf_get(…).
-- Обе функции проверяют общий секрет сервера (app_private.tg_secret_ok, переменная TG_DB_SECRET).
-- Сводка лежит в app_private: из браузера её не прочитать, только функциями по секрету.

create table if not exists app_private.pf_snapshots (
  owner      uuid primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);
alter table app_private.pf_snapshots enable row level security;   -- без политик: только функции базы

-- компьютер владельца: записать сводку
create or replace function public.pf_put(p_secret text, p_email text, p_data jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if not app_private.tg_secret_ok(p_secret) then raise exception 'not_granted' using errcode = '42501'; end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then raise exception 'bad_data' using errcode = '22023'; end if;
  if pg_column_size(p_data) > 500000 then raise exception 'too_large' using errcode = '54000'; end if;
  select id into uid from auth.users where lower(email) = lower(btrim(coalesce(p_email, ''))) limit 1;
  if uid is null then return false; end if;
  insert into app_private.pf_snapshots (owner, data, updated_at) values (uid, p_data, now())
  on conflict (owner) do update set data = excluded.data, updated_at = now();
  return true;
end $$;

-- бот: сводка владельца этого чата; null — чат не подключён, {"none":true} — сводки ещё нет
create or replace function public.pf_get(p_secret text, p_chat bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare o uuid; d app_private.pf_snapshots;
begin
  if not app_private.tg_secret_ok(p_secret) then raise exception 'not_granted' using errcode = '42501'; end if;
  select owner into o from public.tg_links where chat_id = p_chat;
  if o is null then return null; end if;
  select * into d from app_private.pf_snapshots where owner = o;
  if not found then return jsonb_build_object('none', true); end if;
  return d.data || jsonb_build_object('stored_at', d.updated_at);
end $$;

revoke all on function public.pf_put(text, text, jsonb) from public;
revoke all on function public.pf_get(text, bigint) from public;
grant execute on function public.pf_put(text, text, jsonb) to anon, authenticated;
grant execute on function public.pf_get(text, bigint) to anon, authenticated;

-- Vercel Cron (вечерний обзор): личные чаты с ботом (chat_id > 0) владельцев, у которых в сводке включён digest
create or replace function public.pf_digest(p_secret text) returns table (chat_id bigint, data jsonb)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not app_private.tg_secret_ok(p_secret) then raise exception 'not_granted' using errcode = '42501'; end if;
  return query
    select l.chat_id, s.data || jsonb_build_object('stored_at', s.updated_at)
      from app_private.pf_snapshots s
      join public.tg_links l on l.owner = s.owner
     where l.chat_id > 0 and coalesce((s.data ->> 'digest')::boolean, false);
end $$;
revoke all on function public.pf_digest(text) from public;
grant execute on function public.pf_digest(text) to anon, authenticated;
