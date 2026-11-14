-- =====================================================================
--  KaizenHub: руководители приглашают руководителей
--
--  Раньше выдавать доступ руководителя мог только владелец. Теперь:
--    • руководитель владельца (team/<владелец>/managers/<id>) создаёт ссылки-приглашения в команду
--      с ролью lead (руководитель) и arealead (руководитель области) — от имени владельца;
--    • руководитель области (team/<владелец>/areas/<область>/<id>) — только arealead и только для своей области.
--  Вход по таким ссылкам проверяют прежние правила (lead_invite_matches, area_invite_matches).
--  Меняется только ветка «ссылки в команду» в app_private.can_write_doc; остальные права — без изменений.
--  Миграцию можно безопасно запустить повторно.
-- =====================================================================

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
      -- руководитель владельца приглашает в команду, в том числе новых руководителей (общих и областей)
      if app_private.is_manager_of(p_new ->> 'ownerId') then
        return not p_exists or p_old ->> 'ownerId' = p_new ->> 'ownerId';
      end if;
      -- руководитель области приглашает только руководителей своей области
      return coalesce(p_new ->> 'role', '') = 'arealead'
         and app_private.is_area_lead(p_new ->> 'ownerId', p_new ->> 'area')
         and (not p_exists or (p_old ->> 'ownerId' = p_new ->> 'ownerId' and p_old ->> 'area' = p_new ->> 'area'));
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
