-- =====================================================================
--  KaizenHub: начальная схема базы (Supabase / Postgres)
--
--  Идея: приложение хранит «документы» по путям вида
--      data/users/<id>/<ключ>        личные данные человека
--      sp/<проект>                   общий проект (владелец, участники)
--      sp/<проект>/tasks/<id>        подэтапы проекта
--      sp/<проект>/joins/<id>        кто вошёл по ссылке-приглашению
--      inv/<код>                     ссылка-приглашение
--  Всё это лежит в одной таблице public.docs.
--  Читать можно только по SELECT-правилам (RLS), а ВСЕ записи идут через
--  функции doc_set / doc_update / doc_delete, которые проверяют права ролей.
-- =====================================================================

-- ---------- служебная схема для проверок прав ----------
create schema if not exists app_private;
grant usage on schema app_private to authenticated;

-- ---------- таблица документов ----------
create table public.docs (
  path       text primary key
             check (length(path) between 1 and 400
                    and path !~ '//' and path !~ '^/' and path !~ '/$'),
  parent     text not null default '',
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create index docs_parent_idx on public.docs (parent);
create index docs_member_ids_idx on public.docs using gin ((data -> 'memberIds'));

create or replace function app_private.docs_before_write() returns trigger
language plpgsql as $$
begin
  new.parent     := case when position('/' in new.path) = 0 then ''
                         else regexp_replace(new.path, '/[^/]*$', '') end;
  new.updated_at := now();
  return new;
end $$;

create trigger docs_before_write before insert or update on public.docs
  for each row execute function app_private.docs_before_write();

-- ---------- проверки доступа ----------
-- есть ли у текущего человека доступ к проекту (владелец, участник или вошёл по ссылке)
create or replace function app_private.can_access_project(pid text) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    exists (select 1 from public.docs d
            where d.path = 'sp/' || pid
              and (d.data ->> 'ownerId' = auth.uid()::text
                   or jsonb_exists(coalesce(d.data -> 'memberIds', '[]'::jsonb), auth.uid()::text)))
    or exists (select 1 from public.docs j
               where j.path = 'sp/' || pid || '/joins/' || auth.uid()::text)
  );
$$;

create or replace function app_private.is_project_owner(pid text) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (
    select 1 from public.docs d
    where d.path = 'sp/' || pid and d.data ->> 'ownerId' = auth.uid()::text);
$$;

-- существует ли живая ссылка-приглашение с таким кодом, проектом и ролью
create or replace function app_private.invite_matches(code text, pid text, role text) returns boolean
language sql stable security definer set search_path = public as $$
  select code is not null and code ~ '^[a-z0-9]{8,32}$' and exists (
    select 1 from public.docs i
    where i.path = 'inv/' || code
      and i.data ->> 'pid' = pid
      and i.data ->> 'role' is not distinct from role);
$$;

-- кто что может читать
create or replace function app_private.can_read_doc(p_path text, p_data jsonb) returns boolean
language sql stable as $$
  select auth.uid() is not null and (
    case split_part(p_path, '/', 1)
      when 'data' then split_part(p_path, '/', 2) = 'users'
                       and split_part(p_path, '/', 3) = auth.uid()::text
      when 'sp'   then app_private.can_access_project(split_part(p_path, '/', 2))
                       or (split_part(p_path, '/', 3) = 'joins'
                           and split_part(p_path, '/', 4) = auth.uid()::text)
      when 'inv'  then p_data ->> 'ownerId' = auth.uid()::text
      else false
    end);
$$;

-- кто что может записать
create or replace function app_private.can_write_doc(p_path text, p_new jsonb, p_old jsonb, p_exists boolean)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  uid text := auth.uid()::text;
  s1 text := split_part(p_path, '/', 1);
  s2 text := split_part(p_path, '/', 2);
  s3 text := split_part(p_path, '/', 3);
  s4 text := split_part(p_path, '/', 4);
  n  int  := array_length(string_to_array(p_path, '/'), 1);
begin
  if uid is null then return false; end if;

  -- личные данные: только свои
  if s1 = 'data' and s2 = 'users' then
    return s3 = uid and n >= 4;
  end if;

  if s1 = 'sp' then
    if n = 2 then                                  -- сам проект
      if not p_exists then
        return p_new ->> 'ownerId' = uid;          -- создавать можно только от своего имени
      end if;
      if not app_private.can_access_project(s2) then return false; end if;
      if p_old ->> 'ownerId' = uid then
        return p_new ->> 'ownerId' = uid;          -- владелец не передаёт проект молча
      end if;
      -- участник правит содержимое, но не владельца и не состав участников
      return p_new ->> 'ownerId' is not distinct from p_old ->> 'ownerId'
         and coalesce(p_new -> 'members',   '[]'::jsonb) = coalesce(p_old -> 'members',   '[]'::jsonb)
         and coalesce(p_new -> 'memberIds', '[]'::jsonb) = coalesce(p_old -> 'memberIds', '[]'::jsonb);
    elsif n = 4 and s3 = 'tasks' then              -- подэтапы
      return app_private.can_access_project(s2);
    elsif n = 4 and s3 = 'joins' then              -- вход по ссылке
      if app_private.is_project_owner(s2) then return true; end if;
      return s4 = uid and not p_exists
         and app_private.invite_matches(p_new ->> 'code', s2, p_new ->> 'role');
    end if;
    return false;
  end if;

  if s1 = 'inv' and n = 2 then                     -- ссылки-приглашения создаёт владелец проекта
    return p_new ->> 'ownerId' = uid
       and app_private.is_project_owner(p_new ->> 'pid')
       and (not p_exists or p_old ->> 'ownerId' = uid);
  end if;

  return false;
end $$;

-- кто что может удалить
create or replace function app_private.can_delete_doc(p_path text, p_old jsonb)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  uid text := auth.uid()::text;
  s1 text := split_part(p_path, '/', 1);
  s2 text := split_part(p_path, '/', 2);
  s3 text := split_part(p_path, '/', 3);
  s4 text := split_part(p_path, '/', 4);
  n  int  := array_length(string_to_array(p_path, '/'), 1);
begin
  if uid is null then return false; end if;
  if s1 = 'data' and s2 = 'users' then return s3 = uid and n >= 4; end if;
  if s1 = 'sp' and n = 2 then return app_private.is_project_owner(s2); end if;
  if s1 = 'sp' and n = 4 and s3 = 'tasks' then return app_private.can_access_project(s2); end if;
  if s1 = 'sp' and n = 4 and s3 = 'joins' then return app_private.is_project_owner(s2) or s4 = uid; end if;
  if s1 = 'inv' and n = 2 then return p_old ->> 'ownerId' = uid; end if;
  return false;
end $$;

-- ---------- чтение: только через RLS ----------
alter table public.docs enable row level security;
revoke all on public.docs from public, anon, authenticated;
grant select on public.docs to authenticated;

create policy docs_select on public.docs for select to authenticated
  using (app_private.can_read_doc(path, data));

-- ---------- запись: только через функции ----------
create or replace function public.doc_set(p_path text, p_data jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare old jsonb; ex boolean;
begin
  if octet_length(p_data::text) > 2000000 then
    raise exception 'too_large' using errcode = '54000';
  end if;
  select data into old from public.docs where path = p_path for update;
  ex := found;
  if not app_private.can_write_doc(p_path, p_data, old, ex) then
    raise exception 'not_granted' using errcode = '42501';
  end if;
  insert into public.docs (path, data) values (p_path, p_data)
    on conflict (path) do update set data = excluded.data;
end $$;

create or replace function public.doc_update(p_path text, p_patch jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare old jsonb; merged jsonb;
begin
  select data into old from public.docs where path = p_path for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  merged := old || p_patch;
  if octet_length(merged::text) > 2000000 then
    raise exception 'too_large' using errcode = '54000';
  end if;
  if not app_private.can_write_doc(p_path, merged, old, true) then
    raise exception 'not_granted' using errcode = '42501';
  end if;
  update public.docs set data = merged where path = p_path;
end $$;

create or replace function public.doc_delete(p_path text) returns void
language plpgsql security definer set search_path = public as $$
declare old jsonb; pid text;
begin
  select data into old from public.docs where path = p_path for update;
  if not found then return; end if;                -- удалять нечего: не ошибка
  if not app_private.can_delete_doc(p_path, old) then
    raise exception 'not_granted' using errcode = '42501';
  end if;
  delete from public.docs where path = p_path;
  -- удалили проект целиком: убираем его подэтапы, входы и ссылки
  if split_part(p_path, '/', 1) = 'sp' and array_length(string_to_array(p_path, '/'), 1) = 2 then
    pid := split_part(p_path, '/', 2);
    delete from public.docs where path like p_path || '/%';
    delete from public.docs where path like 'inv/%' and data ->> 'pid' = pid;
  end if;
end $$;

-- прочитать ссылку-приглашение по коду (перебором не найти: напрямую таблицу читать нельзя)
create or replace function public.invite_get(p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select d.data from public.docs d
  where auth.uid() is not null and p_code ~ '^[a-z0-9]{8,32}$' and d.path = 'inv/' || p_code;
$$;

-- ---------- профили людей ----------
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  name       text not null default '',
  email      text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
revoke all on public.profiles from public, anon, authenticated;
grant select, update (name) on public.profiles to authenticated;
create policy profiles_select_own on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create or replace function app_private.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, email)
  values (new.id,
          coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), split_part(coalesce(new.email, ''), '@', 1)),
          coalesce(new.email, ''))
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function app_private.handle_new_user();

-- те, кто уже зарегистрирован до запуска этой схемы
insert into public.profiles (id, name, email)
select u.id, coalesce(nullif(u.raw_user_meta_data ->> 'name', ''), split_part(coalesce(u.email, ''), '@', 1)), coalesce(u.email, '')
from auth.users u on conflict (id) do nothing;

-- поиск коллеги: по части имени (от 2 букв) или по точному email; без запроса не показываем никого
create or replace function public.search_users(q text)
returns table (id uuid, name text, email text)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.email from public.profiles p
  where auth.uid() is not null and p.id <> auth.uid()
    and length(trim(coalesce(q, ''))) >= 2
    and (p.name ilike '%' || replace(replace(trim(q), '%', ''), '_', '') || '%'
         or lower(p.email) = lower(trim(q)))
  order by p.name limit 10;
$$;

-- профили по списку id (имя и email показываются участникам проекта)
create or replace function public.get_profiles(ids uuid[])
returns table (id uuid, name text, email text)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.email from public.profiles p
  where auth.uid() is not null and p.id = any (ids);
$$;

-- ---------- права на функции ----------
revoke all on function public.doc_set(text, jsonb)     from public, anon;
revoke all on function public.doc_update(text, jsonb)  from public, anon;
revoke all on function public.doc_delete(text)         from public, anon;
revoke all on function public.invite_get(text)         from public, anon;
revoke all on function public.search_users(text)       from public, anon;
revoke all on function public.get_profiles(uuid[])     from public, anon;
grant execute on function public.doc_set(text, jsonb)     to authenticated;
grant execute on function public.doc_update(text, jsonb)  to authenticated;
grant execute on function public.doc_delete(text)         to authenticated;
grant execute on function public.invite_get(text)         to authenticated;
grant execute on function public.search_users(text)       to authenticated;
grant execute on function public.get_profiles(uuid[])     to authenticated;

revoke all on all functions in schema app_private from public, anon;
grant execute on function app_private.can_access_project(text)                  to authenticated;
grant execute on function app_private.is_project_owner(text)                    to authenticated;
grant execute on function app_private.invite_matches(text, text, text)          to authenticated;
grant execute on function app_private.can_read_doc(text, jsonb)                 to authenticated;
grant execute on function app_private.can_write_doc(text, jsonb, jsonb, boolean) to authenticated;
grant execute on function app_private.can_delete_doc(text, jsonb)               to authenticated;

-- ---------- мгновенная синхронизация (Realtime) ----------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.docs;
  end if;
end $$;
