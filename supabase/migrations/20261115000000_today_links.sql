-- =====================================================================
--  KaizenHub: «Сегодня» по ссылке без входа
--
--  Владелец пространства делится списком задач на день (весь план или план одного человека):
--      today/<код>            { ownerId, who, name, date, items:[{ k, title, where, due, done }], at }
--  Документ пишет и удаляет только владелец (ownerId = он сам). Читать напрямую его может только владелец.
--  Человек без аккаунта открывает /today/?c=<код>:
--      • public.today_get(код)            — отдаёт этот список (и только его; перебором кодов не найти: код 20–40 символов);
--      • public.today_tick(код, k, done)  — ставит отметку today/<код>/ticks/<k> только для задачи из этого списка.
--  Приложение владельца видит отметки, отмечает задачу на общей доске и удаляет отметку.
--  Закрыть ссылку = удалить документ today/<код> (приложение сначала удаляет его отметки).
--  Миграция только добавляет раздел today/; остальные права не меняются. Её можно безопасно запустить повторно.
-- =====================================================================

-- текущий человек — владелец ссылки «Сегодня»?
create or replace function app_private.is_today_owner(code text) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (
    select 1 from public.docs d where d.path = 'today/' || code and d.data ->> 'ownerId' = auth.uid()::text);
$$;
revoke all on function app_private.is_today_owner(text) from public, anon;
grant execute on function app_private.is_today_owner(text) to authenticated;

-- список «Сегодня» по коду: доступен и без входа (только по точному коду)
create or replace function public.today_get(p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select d.data - 'ownerId' from public.docs d
  where p_code ~ '^[a-z0-9]{20,40}$' and d.path = 'today/' || p_code;
$$;
revoke all on function public.today_get(text) from public;
grant execute on function public.today_get(text) to anon, authenticated;

-- отметка по ссылке: только задача из этого списка, одна отметка на задачу (последняя побеждает)
create or replace function public.today_tick(p_code text, p_key text, p_done boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  d jsonb;
begin
  if p_code !~ '^[a-z0-9]{20,40}$' or p_key is null or p_key !~ '^[A-Za-z0-9|_.-]{1,160}$' then
    raise exception 'bad request' using errcode = '22023';
  end if;
  select data into d from public.docs where path = 'today/' || p_code;
  if d is null then raise exception 'link not found' using errcode = 'P0002'; end if;
  if not exists (select 1 from jsonb_array_elements(coalesce(d -> 'items', '[]'::jsonb)) i where i ->> 'k' = p_key) then
    raise exception 'not in list' using errcode = '42501';
  end if;
  insert into public.docs (path, data)
  values ('today/' || p_code || '/ticks/' || replace(p_key, '|', '~'), jsonb_build_object('k', p_key, 'done', coalesce(p_done, false), 'at', now()))
  on conflict (path) do update set data = excluded.data;
end $$;
revoke all on function public.today_tick(text, text, boolean) from public;
grant execute on function public.today_tick(text, text, boolean) to anon, authenticated;

-- кто что может читать (добавлен раздел today/)
create or replace function app_private.can_read_doc(p_path text, p_data jsonb) returns boolean
language sql stable as $$
  select auth.uid() is not null and (
    case split_part(p_path, '/', 1)
      when 'data' then split_part(p_path, '/', 2) = 'users'
                       and (split_part(p_path, '/', 3) = auth.uid()::text
                            or (array_length(string_to_array(p_path, '/'), 1) = 4
                                and app_private.is_manager_of(split_part(p_path, '/', 3)))
                            -- руководитель области: запись пространства этой области и её название
                            or (array_length(string_to_array(p_path, '/'), 1) = 6
                                and split_part(p_path, '/', 4) = 'spaces'
                                and ((split_part(p_path, '/', 5) = 'list'
                                      and app_private.is_area_lead(split_part(p_path, '/', 3), p_data ->> 'area'))
                                  or (split_part(p_path, '/', 5) = 'area'
                                      and app_private.is_area_lead(split_part(p_path, '/', 3), split_part(p_path, '/', 6)))))
                            -- и данные такого пространства
                            or (array_length(string_to_array(p_path, '/'), 1) = 8
                                and split_part(p_path, '/', 4) = 'spaces'
                                and split_part(p_path, '/', 5) = 'list'
                                and split_part(p_path, '/', 7) = 'items'
                                and app_private.can_area_space(split_part(p_path, '/', 3), split_part(p_path, '/', 6))))
      when 'sp'   then app_private.can_access_project(split_part(p_path, '/', 2))
                       or (split_part(p_path, '/', 3) = 'joins'
                           and split_part(p_path, '/', 4) = auth.uid()::text)
      when 'inv'  then p_data ->> 'ownerId' = auth.uid()::text
                       or app_private.is_manager_of(p_data ->> 'ownerId')
      when 'team' then (split_part(p_path, '/', 3) = 'members'
                        and (split_part(p_path, '/', 2) = auth.uid()::text
                             or split_part(p_path, '/', 4) = auth.uid()::text
                             or app_private.is_manager_of(split_part(p_path, '/', 2))))
                    or (split_part(p_path, '/', 3) = 'managers'
                        and (split_part(p_path, '/', 2) = auth.uid()::text
                             or split_part(p_path, '/', 4) = auth.uid()::text))
                    or (split_part(p_path, '/', 3) = 'areas'
                        and array_length(string_to_array(p_path, '/'), 1) = 5
                        and (split_part(p_path, '/', 2) = auth.uid()::text
                             or split_part(p_path, '/', 5) = auth.uid()::text))
      when 'today' then (array_length(string_to_array(p_path, '/'), 1) = 2 and p_data ->> 'ownerId' = auth.uid()::text)
                       or (array_length(string_to_array(p_path, '/'), 1) = 4 and split_part(p_path, '/', 3) = 'ticks'
                           and app_private.is_today_owner(split_part(p_path, '/', 2)))
      when 'it'   then p_data ->> 'ownerId' = auth.uid()::text
                       or app_private.is_manager_of(p_data ->> 'ownerId')
                       or jsonb_exists(coalesce(p_data -> 'memberIds', '[]'::jsonb), auth.uid()::text)
      else false
    end);
$$;

-- кто что может записать (добавлен раздел today/)
create or replace function app_private.can_write_doc(p_path text, p_new jsonb, p_old jsonb, p_exists boolean)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  uid text := auth.uid()::text;
  s1 text := split_part(p_path, '/', 1);
  s2 text := split_part(p_path, '/', 2);
  s3 text := split_part(p_path, '/', 3);
  s4 text := split_part(p_path, '/', 4);
  s5 text := split_part(p_path, '/', 5);
  n  int  := array_length(string_to_array(p_path, '/'), 1);
begin
  if uid is null then return false; end if;

  -- личные данные: свои; руководитель — основное пространство владельца (только верхний уровень);
  -- руководитель области — данные пространств своей области (но не сами записи пространств)
  if s1 = 'data' and s2 = 'users' then
    return (s3 = uid and n >= 4) or (n = 4 and app_private.is_manager_of(s3))
        or (n = 8 and s4 = 'spaces' and s5 = 'list' and split_part(p_path, '/', 7) = 'items'
            and app_private.can_area_space(s3, split_part(p_path, '/', 6)));
  end if;

  if s1 = 'sp' then
    if n = 2 then                                  -- сам проект
      if not p_exists then                         -- создавать можно от своего имени или от имени владельца-руководителя
        return p_new ->> 'ownerId' = uid or app_private.is_manager_of(p_new ->> 'ownerId');
      end if;
      if not app_private.can_access_project(s2) then return false; end if;
      if p_old ->> 'ownerId' = uid or app_private.is_manager_of(p_old ->> 'ownerId') then
        return p_new ->> 'ownerId' is not distinct from p_old ->> 'ownerId';   -- владелец проекта не меняется
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
    if p_new ->> 'kind' = 'team' then              -- ссылка в команду
      if p_new ->> 'ownerId' = uid then
        return not p_exists or p_old ->> 'ownerId' = uid;
      end if;
      -- руководитель приглашает в команду владельца, но не новых руководителей (ни общих, ни областей)
      return app_private.is_manager_of(p_new ->> 'ownerId')
         and coalesce(p_new ->> 'role', '') not in ('lead', 'arealead')
         and (not p_exists or p_old ->> 'ownerId' = p_new ->> 'ownerId');
    end if;
    -- ссылки в проект создаёт владелец проекта (или его руководитель) от имени владельца
    return (p_new ->> 'ownerId' = uid or app_private.is_manager_of(p_new ->> 'ownerId'))
       and app_private.is_project_owner(p_new ->> 'pid')
       and (not p_exists or p_old ->> 'ownerId' = p_new ->> 'ownerId');
  end if;

  if s1 = 'team' and n = 4 and s3 = 'members' then
    if s2 = uid or app_private.is_manager_of(s2) then return true; end if;   -- владелец и руководители управляют списком
    return s4 = uid and not p_exists               -- человек вписывает себя один раз и только по живой ссылке
       and app_private.team_invite_matches(p_new ->> 'code', s2);
  end if;

  if s1 = 'team' and n = 4 and s3 = 'managers' then
    if s2 = uid then return true; end if;          -- владелец назначает руководителей сам
    return s4 = uid and not p_exists               -- или человек вписывает себя по живой ссылке руководителя
       and app_private.lead_invite_matches(p_new ->> 'code', s2);
  end if;

  if s1 = 'team' and n = 5 and s3 = 'areas' then
    if s2 = uid then return true; end if;          -- владелец назначает руководителей области сам
    return s5 = uid and not p_exists               -- или человек вписывает себя по живой ссылке именно на эту область
       and app_private.area_invite_matches(p_new ->> 'code', s2, s4);
  end if;

  -- «Сегодня» по ссылке: список пишет только его владелец; отметки (ticks) — только функцией today_tick
  if s1 = 'today' and n = 2 then
    return p_new ->> 'ownerId' = uid and (not p_exists or p_old ->> 'ownerId' = uid);
  end if;

  -- внутренние задачи: ставит владелец или его руководитель; исполнитель меняет задачу, но не владельца и не исполнителей
  if s1 = 'it' and n = 2 then
    if not p_exists then
      return p_new ->> 'ownerId' = uid or app_private.is_manager_of(p_new ->> 'ownerId');
    end if;
    if p_old ->> 'ownerId' = uid or app_private.is_manager_of(p_old ->> 'ownerId') then
      return p_new ->> 'ownerId' is not distinct from p_old ->> 'ownerId';
    end if;
    return jsonb_exists(coalesce(p_old -> 'memberIds', '[]'::jsonb), uid)
       and p_new ->> 'ownerId' is not distinct from p_old ->> 'ownerId'
       and coalesce(p_new -> 'memberIds', '[]'::jsonb) = coalesce(p_old -> 'memberIds', '[]'::jsonb);
  end if;

  return false;
end $$;

-- кто что может удалить (добавлен раздел today/)
create or replace function app_private.can_delete_doc(p_path text, p_old jsonb)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  uid text := auth.uid()::text;
  s1 text := split_part(p_path, '/', 1);
  s2 text := split_part(p_path, '/', 2);
  s3 text := split_part(p_path, '/', 3);
  s4 text := split_part(p_path, '/', 4);
  s5 text := split_part(p_path, '/', 5);
  n  int  := array_length(string_to_array(p_path, '/'), 1);
begin
  if uid is null then return false; end if;
  if s1 = 'data' and s2 = 'users' then
    return (s3 = uid and n >= 4) or (n = 4 and app_private.is_manager_of(s3))
        or (n = 8 and s4 = 'spaces' and s5 = 'list' and split_part(p_path, '/', 7) = 'items'
            and app_private.can_area_space(s3, split_part(p_path, '/', 6)));
  end if;
  if s1 = 'sp' and n = 2 then return app_private.is_project_owner(s2); end if;
  if s1 = 'sp' and n = 4 and s3 = 'tasks' then return app_private.can_access_project(s2); end if;
  if s1 = 'sp' and n = 4 and s3 = 'joins' then return app_private.is_project_owner(s2) or s4 = uid; end if;
  if s1 = 'inv' and n = 2 then return p_old ->> 'ownerId' = uid or app_private.is_manager_of(p_old ->> 'ownerId'); end if;
  if s1 = 'team' and n = 4 and s3 = 'members' then return s2 = uid or s4 = uid or app_private.is_manager_of(s2); end if;
  if s1 = 'team' and n = 4 and s3 = 'managers' then return s2 = uid or s4 = uid; end if;
  if s1 = 'team' and n = 5 and s3 = 'areas' then return s2 = uid or s5 = uid; end if;
  if s1 = 'today' and n = 2 then return p_old ->> 'ownerId' = uid; end if;
  if s1 = 'today' and n = 4 and s3 = 'ticks' then return app_private.is_today_owner(s2); end if;
  if s1 = 'it' and n = 2 then return p_old ->> 'ownerId' = uid or app_private.is_manager_of(p_old ->> 'ownerId'); end if;
  return false;
end $$;
