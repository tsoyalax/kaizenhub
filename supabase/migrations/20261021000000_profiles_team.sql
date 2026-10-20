-- =====================================================================
--  KaizenHub: профили людей и приглашения в команду по ссылке
--
--  Профиль: имя, фото (из Google), должность, контакт. Человек правит только свой.
--  Команда:
--      inv/<код>                       ссылка-приглашение, kind = 'team' (без проекта)
--      team/<владелец>/members/<id>    кто вошёл в команду по ссылке
--  Владелец видит, кто принял приглашение, и сам открывает таким людям проекты,
--  где они назначены (через уже существующий sp/<проект>.memberIds).
--  Миграция только добавляет: старые данные и правила для проектов не меняются.
-- =====================================================================

-- ---------- профили ----------
alter table public.profiles add column if not exists avatar_url text not null default '';
alter table public.profiles add column if not exists job_title   text not null default '';
alter table public.profiles add column if not exists contact    text not null default '';
alter table public.profiles add constraint profiles_lengths_chk
  check (length(name) <= 120 and length(job_title) <= 120 and length(contact) <= 200 and length(avatar_url) <= 1000);

grant update (name, job_title, contact) on public.profiles to authenticated;

-- новые люди: имя и фото берём из Google, если вошли через него
create or replace function app_private.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, email, avatar_url)
  values (new.id,
          left(coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), nullif(new.raw_user_meta_data ->> 'full_name', ''),
                        split_part(coalesce(new.email, ''), '@', 1)), 120),
          coalesce(new.email, ''),
          left(coalesce(nullif(new.raw_user_meta_data ->> 'avatar_url', ''), nullif(new.raw_user_meta_data ->> 'picture', ''), ''), 1000))
  on conflict (id) do nothing;
  return new;
end $$;

-- уже зарегистрированные через Google: подтягиваем фото
update public.profiles p
   set avatar_url = left(coalesce(nullif(u.raw_user_meta_data ->> 'avatar_url', ''), nullif(u.raw_user_meta_data ->> 'picture', ''), ''), 1000)
  from auth.users u
 where u.id = p.id and p.avatar_url = '';

-- профили по списку id, вместе с фото, должностью и контактом
create or replace function public.get_profiles_full(ids uuid[])
returns table (id uuid, name text, email text, avatar_url text, job_title text, contact text)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.email, p.avatar_url, p.job_title, p.contact from public.profiles p
  where auth.uid() is not null and p.id = any (ids);
$$;
revoke all on function public.get_profiles_full(uuid[]) from public, anon;
grant execute on function public.get_profiles_full(uuid[]) to authenticated;

-- ---------- приглашения в команду ----------
create or replace function app_private.team_invite_matches(code text, owner_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select code is not null and code ~ '^[a-z0-9]{8,32}$' and exists (
    select 1 from public.docs i
    where i.path = 'inv/' || code
      and i.data ->> 'kind' = 'team'
      and i.data ->> 'ownerId' = owner_id);
$$;
revoke all on function app_private.team_invite_matches(text, text) from public, anon;
grant execute on function app_private.team_invite_matches(text, text) to authenticated;

-- кто что может читать (добавлен раздел team/)
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
      when 'team' then split_part(p_path, '/', 3) = 'members'
                       and (split_part(p_path, '/', 2) = auth.uid()::text
                            or split_part(p_path, '/', 4) = auth.uid()::text)
      else false
    end);
$$;

-- кто что может записать (добавлены ссылки в команду и раздел team/)
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

  if s1 = 'inv' and n = 2 then
    if p_new ->> 'kind' = 'team' then              -- ссылка в команду: от своего имени, без проекта
      return p_new ->> 'ownerId' = uid
         and (not p_exists or p_old ->> 'ownerId' = uid);
    end if;
    -- ссылки в проект создаёт владелец проекта
    return p_new ->> 'ownerId' = uid
       and app_private.is_project_owner(p_new ->> 'pid')
       and (not p_exists or p_old ->> 'ownerId' = uid);
  end if;

  if s1 = 'team' and n = 4 and s3 = 'members' then
    if s2 = uid then return true; end if;          -- владелец команды управляет списком
    return s4 = uid and not p_exists               -- человек вписывает себя один раз и только по живой ссылке
       and app_private.team_invite_matches(p_new ->> 'code', s2);
  end if;

  return false;
end $$;

-- кто что может удалить (добавлен раздел team/)
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
  if s1 = 'team' and n = 4 and s3 = 'members' then return s2 = uid or s4 = uid; end if;
  return false;
end $$;
