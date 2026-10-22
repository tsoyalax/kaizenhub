-- =====================================================================
--  KaizenHub: внутренние задачи (офис, HR, поручения — без клиентского проекта)
--
--  Каждая задача — документ it/<id>:
--      ownerId    — владелец команды (данные чьей команды)
--      memberIds  — аккаунты, которым видна задача: владелец и исполнитель (если он уже вошёл в приложение)
--      json       — сама задача: название, описание, исполнитель, постановщик, статус, приоритет, срок, категория
--  Видят: владелец, его руководители, исполнитель. Ставят и удаляют: владелец и руководители.
--  Исполнитель меняет задачу (статус), но не владельца и не список исполнителей.
--  Миграция только добавляет раздел it/; остальные права не меняются. Её можно безопасно запустить повторно.
-- =====================================================================

-- кто что может читать (добавлены внутренние задачи)
create or replace function app_private.can_read_doc(p_path text, p_data jsonb) returns boolean
language sql stable as $$
  select auth.uid() is not null and (
    case split_part(p_path, '/', 1)
      when 'data' then split_part(p_path, '/', 2) = 'users'
                       and (split_part(p_path, '/', 3) = auth.uid()::text
                            or (array_length(string_to_array(p_path, '/'), 1) = 4
                                and app_private.is_manager_of(split_part(p_path, '/', 3))))
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
      when 'it'   then p_data ->> 'ownerId' = auth.uid()::text
                       or app_private.is_manager_of(p_data ->> 'ownerId')
                       or jsonb_exists(coalesce(p_data -> 'memberIds', '[]'::jsonb), auth.uid()::text)
      else false
    end);
$$;

-- кто что может записать (добавлены внутренние задачи)
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

  -- личные данные: свои; руководитель — основное пространство владельца (только верхний уровень)
  if s1 = 'data' and s2 = 'users' then
    return (s3 = uid and n >= 4) or (n = 4 and app_private.is_manager_of(s3));
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
      -- руководитель приглашает в команду владельца, но не новых руководителей
      return app_private.is_manager_of(p_new ->> 'ownerId')
         and p_new ->> 'role' is distinct from 'lead'
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

-- кто что может удалить (добавлены внутренние задачи)
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
  if s1 = 'data' and s2 = 'users' then return (s3 = uid and n >= 4) or (n = 4 and app_private.is_manager_of(s3)); end if;
  if s1 = 'sp' and n = 2 then return app_private.is_project_owner(s2); end if;
  if s1 = 'sp' and n = 4 and s3 = 'tasks' then return app_private.can_access_project(s2); end if;
  if s1 = 'sp' and n = 4 and s3 = 'joins' then return app_private.is_project_owner(s2) or s4 = uid; end if;
  if s1 = 'inv' and n = 2 then return p_old ->> 'ownerId' = uid or app_private.is_manager_of(p_old ->> 'ownerId'); end if;
  if s1 = 'team' and n = 4 and s3 = 'members' then return s2 = uid or s4 = uid or app_private.is_manager_of(s2); end if;
  if s1 = 'team' and n = 4 and s3 = 'managers' then return s2 = uid or s4 = uid; end if;
  if s1 = 'it' and n = 2 then return p_old ->> 'ownerId' = uid or app_private.is_manager_of(p_old ->> 'ownerId'); end if;
  return false;
end $$;
