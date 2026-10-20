-- =====================================================================
--  KaizenHub: файлы в карточках подэтапов (Supabase Storage)
--
--  Корзина kz-files, закрытая. Пути файлов:
--      <id загрузившего>/p/<проект>/<файл>    файл карточки в проекте
--      <id загрузившего>/t/<шаблон>/<файл>    файл карточки в шаблоне процесса
--  Читать файл может:
--      • тот, кто его загрузил;
--      • файл проекта — любой, у кого есть доступ к этому проекту (владелец, участник, вошедший по ссылке);
--      • файл шаблона — участники любого общего проекта этого владельца, сделанного по этому шаблону.
--  Загружать можно только в свою папку, удалять — только свои файлы.
--  Миграцию можно безопасно запустить повторно.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('kz-files', 'kz-files', false, 26214400)          -- до 25 МБ на файл
on conflict (id) do nothing;

create or replace function app_private.can_read_file(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    split_part(p_name, '/', 1) = auth.uid()::text
    or (split_part(p_name, '/', 2) = 'p' and app_private.can_access_project(split_part(p_name, '/', 3)))
    or (split_part(p_name, '/', 2) = 't' and exists (
          select 1 from public.docs d
          where d.parent = 'sp'
            and d.data ->> 'ownerId' = split_part(p_name, '/', 1)
            and coalesce((d.data ->> 'json')::jsonb ->> 'template_id', '') = split_part(p_name, '/', 3)
            and app_private.can_access_project(split_part(d.path, '/', 2))))
  );
$$;
revoke all on function app_private.can_read_file(text) from public, anon;
grant execute on function app_private.can_read_file(text) to authenticated;

-- правила создаются один раз (без удаления старых — повторный запуск ничего не ломает)
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'kz_files_read') then
    create policy kz_files_read on storage.objects for select to authenticated
      using (bucket_id = 'kz-files' and app_private.can_read_file(name));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'kz_files_insert') then
    create policy kz_files_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'kz-files' and split_part(name, '/', 1) = auth.uid()::text
                  and split_part(name, '/', 2) in ('p', 't') and split_part(name, '/', 4) <> '');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'kz_files_delete') then
    create policy kz_files_delete on storage.objects for delete to authenticated
      using (bucket_id = 'kz-files' and split_part(name, '/', 1) = auth.uid()::text);
  end if;
end $$;
