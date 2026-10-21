-- Проверка прав: владелец / участник / посторонний / гость по ссылке, профили и команда.
-- Запуск: tests/db/run.sh (поднимает временный Postgres и применяет все миграции).
\set ON_ERROR_STOP on
set client_min_messages = warning;

-- люди: O — владелец, M — участник проекта, G — гость по ссылке, S — посторонний, T — новичок в команде
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'o@x.y', '{"name":"Owner"}'),
  ('00000000-0000-0000-0000-00000000000b', 'm@x.y', '{}'),
  ('00000000-0000-0000-0000-00000000000c', 'g@x.y', '{"full_name":"Guest G","picture":"https://img/g.png"}'),
  ('00000000-0000-0000-0000-00000000000d', 's@x.y', '{}'),
  ('00000000-0000-0000-0000-00000000000e', 't@x.y', '{"name":"Team T","avatar_url":"https://img/t.png"}'),
  ('00000000-0000-0000-0000-00000000000f', 'l@x.y', '{"name":"Lead L"}');

create temp table results (name text, ok boolean);
grant all on results to authenticated;

-- выполнить действие от имени человека и записать, удалось ли
create or replace function pg_temp.try(who text, sql text) returns boolean language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', who, true);
  execute 'set local role authenticated';
  begin execute sql; exception when others then reset role; return false; end;
  reset role; return true;
end $$;
create or replace function pg_temp.expect(name text, actual boolean, expected boolean) returns void language plpgsql as $$
begin insert into results values (name, actual = expected); end $$;
create or replace function pg_temp.rows_as(who text, sql text) returns int language plpgsql as $$
declare c int;
begin
  perform set_config('request.jwt.claim.sub', who, true);
  execute 'set local role authenticated';
  execute 'select count(*) from (' || sql || ') x' into c;
  reset role; return c;
end $$;

\set O '''00000000-0000-0000-0000-00000000000a'''
\set M '''00000000-0000-0000-0000-00000000000b'''
\set G '''00000000-0000-0000-0000-00000000000c'''
\set S '''00000000-0000-0000-0000-00000000000d'''
\set T '''00000000-0000-0000-0000-00000000000e'''
\set L '''00000000-0000-0000-0000-00000000000f'''

begin;
-- ---------- профили ----------
select pg_temp.expect('профиль: имя из Google full_name', (select name = 'Guest G' from profiles where id = :G), true);
select pg_temp.expect('профиль: фото из Google picture', (select avatar_url = 'https://img/g.png' from profiles where id = :G), true);
select pg_temp.expect('профиль: фото из avatar_url', (select avatar_url = 'https://img/t.png' from profiles where id = :T), true);
select pg_temp.expect('профиль: свой меняется', pg_temp.try(:O, $q$update profiles set job_title='PM', contact='@o' where id = auth.uid()$q$), true);
select pg_temp.expect('профиль: изменение сохранилось', (select job_title = 'PM' and contact = '@o' from profiles where id = :O), true);
select pg_temp.expect('профиль: чужой не меняется', pg_temp.try(:S, $q$do $x$ begin update profiles set job_title='hack' where id = '00000000-0000-0000-0000-00000000000a'; if (select job_title from profiles where id = '00000000-0000-0000-0000-00000000000a') = 'hack' then raise exception 'changed'; end if; end $x$$q$), true);
select pg_temp.expect('профиль: чужой действительно не изменён', (select job_title = 'PM' from profiles where id = :O), true);
select pg_temp.expect('профиль: фото вручную не подменить', pg_temp.try(:O, $q$update profiles set avatar_url='x' where id = auth.uid()$q$), false);
select pg_temp.expect('профиль: email вручную не подменить', pg_temp.try(:O, $q$update profiles set email='x@x' where id = auth.uid()$q$), false);
select pg_temp.expect('профиль: слишком длинная должность отклонена', pg_temp.try(:O, $q$update profiles set job_title=repeat('a',200) where id = auth.uid()$q$), false);
select pg_temp.expect('профиль: коллега видит должность и контакт', pg_temp.rows_as(:M, $q$select * from get_profiles_full(array['00000000-0000-0000-0000-00000000000a']::uuid[]) where job_title='PM' and contact='@o'$q$) = 1, true);

-- ---------- проекты (старые правила не сломаны) ----------
select pg_temp.expect('проект: владелец создаёт', pg_temp.try(:O, $q$select doc_set('sp/p1', '{"ownerId":"00000000-0000-0000-0000-00000000000a","members":[{"id":"00000000-0000-0000-0000-00000000000b","role":"worker"}],"memberIds":["00000000-0000-0000-0000-00000000000b"],"json":"{}"}')$q$), true);
select pg_temp.expect('проект: участник правит содержимое', pg_temp.try(:M, $q$select doc_update('sp/p1', '{"json":"{\"v\":1}"}')$q$), true);
select pg_temp.expect('проект: участник не меняет состав', pg_temp.try(:M, $q$select doc_update('sp/p1', '{"memberIds":[]}')$q$), false);
select pg_temp.expect('проект: посторонний не читает', pg_temp.rows_as(:S, $q$select * from docs where path = 'sp/p1'$q$) = 0, true);
select pg_temp.expect('проект: посторонний не пишет', pg_temp.try(:S, $q$select doc_update('sp/p1', '{"json":"x"}')$q$), false);
select pg_temp.expect('проект: ссылка от владельца', pg_temp.try(:O, $q$select doc_set('inv/projcode01', '{"pid":"p1","ownerId":"00000000-0000-0000-0000-00000000000a","role":"worker"}')$q$), true);
select pg_temp.expect('проект: гость входит по ссылке', pg_temp.try(:G, $q$select doc_set('sp/p1/joins/00000000-0000-0000-0000-00000000000c', '{"code":"projcode01","role":"worker"}')$q$), true);
select pg_temp.expect('проект: гость читает проект', pg_temp.rows_as(:G, $q$select * from docs where path = 'sp/p1'$q$) = 1, true);
select pg_temp.expect('проект: гость с поддельным кодом не входит', pg_temp.try(:S, $q$select doc_set('sp/p1/joins/00000000-0000-0000-0000-00000000000d', '{"code":"wrongcode01","role":"worker"}')$q$), false);
select pg_temp.expect('проект: гость не назначает себе роль руководителя', pg_temp.try(:S, $q$select doc_set('sp/p1/joins/00000000-0000-0000-0000-00000000000d', '{"code":"projcode01","role":"lead"}')$q$), false);

-- ---------- команда по ссылке ----------
select pg_temp.expect('команда: владелец создаёт ссылку', pg_temp.try(:O, $q$select doc_set('inv/teamcode01', '{"kind":"team","ownerId":"00000000-0000-0000-0000-00000000000a","memberId":"u1"}')$q$), true);
select pg_temp.expect('команда: нельзя создать ссылку от чужого имени', pg_temp.try(:S, $q$select doc_set('inv/teamcode02', '{"kind":"team","ownerId":"00000000-0000-0000-0000-00000000000a","memberId":"u1"}')$q$), false);
select pg_temp.expect('команда: новичок читает ссылку по коду', pg_temp.rows_as(:T, $q$select 1 where invite_get('teamcode01') ->> 'kind' = 'team'$q$) = 1, true);
select pg_temp.expect('команда: новичок вписывает себя по ссылке', pg_temp.try(:T, $q$select doc_set('team/00000000-0000-0000-0000-00000000000a/members/00000000-0000-0000-0000-00000000000e', '{"code":"teamcode01","memberId":"u1"}')$q$), true);
select pg_temp.expect('команда: второй раз вписать нельзя', pg_temp.try(:T, $q$select doc_set('team/00000000-0000-0000-0000-00000000000a/members/00000000-0000-0000-0000-00000000000e', '{"code":"teamcode01","memberId":"u9"}')$q$), false);
select pg_temp.expect('команда: без ссылки не вписаться', pg_temp.try(:S, $q$select doc_set('team/00000000-0000-0000-0000-00000000000a/members/00000000-0000-0000-0000-00000000000d', '{"code":"nocode0001"}')$q$), false);
select pg_temp.expect('команда: ссылкой в проект не вписаться в команду', pg_temp.try(:S, $q$select doc_set('team/00000000-0000-0000-0000-00000000000a/members/00000000-0000-0000-0000-00000000000d', '{"code":"projcode01"}')$q$), false);
select pg_temp.expect('команда: нельзя вписать другого человека', pg_temp.try(:T, $q$select doc_set('team/00000000-0000-0000-0000-00000000000a/members/00000000-0000-0000-0000-00000000000d', '{"code":"teamcode01"}')$q$), false);
select pg_temp.expect('команда: владелец видит вошедшего', pg_temp.rows_as(:O, $q$select * from docs where parent = 'team/00000000-0000-0000-0000-00000000000a/members'$q$) = 1, true);
select pg_temp.expect('команда: вошедший видит свою запись', pg_temp.rows_as(:T, $q$select * from docs where parent = 'team/00000000-0000-0000-0000-00000000000a/members'$q$) = 1, true);
select pg_temp.expect('команда: посторонний не видит состав', pg_temp.rows_as(:S, $q$select * from docs where parent like 'team/%'$q$) = 0, true);
select pg_temp.expect('команда: посторонний не видит ссылку', pg_temp.rows_as(:S, $q$select * from docs where path = 'inv/teamcode01'$q$) = 0, true);
select pg_temp.expect('команда: посторонний не удаляет участника', pg_temp.try(:S, $q$select doc_delete('team/00000000-0000-0000-0000-00000000000a/members/00000000-0000-0000-0000-00000000000e')$q$), false);
select pg_temp.expect('команда: владелец отключает ссылку', pg_temp.try(:O, $q$select doc_delete('inv/teamcode01')$q$), true);
select pg_temp.expect('команда: по отключённой ссылке не войти', pg_temp.try(:S, $q$select doc_set('team/00000000-0000-0000-0000-00000000000a/members/00000000-0000-0000-0000-00000000000d', '{"code":"teamcode01"}')$q$), false);
-- владелец открывает проект человеку из команды (как делает приложение при назначении на этап)
select pg_temp.expect('команда: владелец открывает проект участнику', pg_temp.try(:O, $q$select doc_set('sp/p2', '{"ownerId":"00000000-0000-0000-0000-00000000000a","members":[{"id":"00000000-0000-0000-0000-00000000000e","role":"worker","auto":true}],"memberIds":["00000000-0000-0000-0000-00000000000e"],"json":"{}"}')$q$), true);
select pg_temp.expect('команда: участник видит назначенный проект', pg_temp.rows_as(:T, $q$select * from docs where path = 'sp/p2'$q$) = 1, true);
select pg_temp.expect('команда: участник не видит чужой проект', pg_temp.rows_as(:T, $q$select * from docs where path = 'sp/p1'$q$) = 0, true);
select pg_temp.expect('команда: владелец убирает участника', pg_temp.try(:O, $q$select doc_delete('team/00000000-0000-0000-0000-00000000000a/members/00000000-0000-0000-0000-00000000000e')$q$), true);
-- ---------- файлы карточек ----------
-- O делится проектом sp/p1 с M (участник) и G (по ссылке); S посторонний
select pg_temp.expect('файлы: загрузить в свою папку проекта', pg_temp.try(:O, $q$insert into storage.objects (bucket_id, name) values ('kz-files', '00000000-0000-0000-0000-00000000000a/p/p1/a.pdf')$q$), true);
select pg_temp.expect('файлы: нельзя загрузить в чужую папку', pg_temp.try(:S, $q$insert into storage.objects (bucket_id, name) values ('kz-files', '00000000-0000-0000-0000-00000000000a/p/p1/evil.pdf')$q$), false);
select pg_temp.expect('файлы: нельзя загрузить мимо папок проекта/шаблона', pg_temp.try(:S, $q$insert into storage.objects (bucket_id, name) values ('kz-files', '00000000-0000-0000-0000-00000000000d/x.pdf')$q$), false);
select pg_temp.expect('файлы: владелец видит свой файл', pg_temp.rows_as(:O, $q$select * from storage.objects where name like '%/p/p1/a.pdf'$q$) = 1, true);
select pg_temp.expect('файлы: участник проекта видит файл проекта', pg_temp.rows_as(:M, $q$select * from storage.objects where name like '%/p/p1/a.pdf'$q$) = 1, true);
select pg_temp.expect('файлы: вошедший по ссылке видит файл проекта', pg_temp.rows_as(:G, $q$select * from storage.objects where name like '%/p/p1/a.pdf'$q$) = 1, true);
select pg_temp.expect('файлы: посторонний не видит файл проекта', pg_temp.rows_as(:S, $q$select * from storage.objects where name like '%/p/p1/a.pdf'$q$) = 0, true);
select pg_temp.try(:S, $q$delete from storage.objects where name like '%/p/p1/a.pdf'$q$);
select pg_temp.expect('файлы: посторонний не удаляет чужой файл', (select count(*) from storage.objects where name like '%/p/p1/a.pdf') = 1, true);
-- файл шаблона: виден участникам общих проектов этого владельца по этому шаблону
select pg_temp.expect('файлы: файл шаблона загружен', pg_temp.try(:O, $q$insert into storage.objects (bucket_id, name) values ('kz-files', '00000000-0000-0000-0000-00000000000a/t/tplA/guide.pdf')$q$), true);
select pg_temp.expect('файлы: проект p3 по шаблону tplA', pg_temp.try(:O, $q$select doc_set('sp/p3', '{"ownerId":"00000000-0000-0000-0000-00000000000a","members":[{"id":"00000000-0000-0000-0000-00000000000b","role":"worker"}],"memberIds":["00000000-0000-0000-0000-00000000000b"],"json":"{\"template_id\":\"tplA\"}"}')$q$), true);
select pg_temp.expect('файлы: участник проекта по шаблону видит файл шаблона', pg_temp.rows_as(:M, $q$select * from storage.objects where name like '%/t/tplA/guide.pdf'$q$) = 1, true);
select pg_temp.expect('файлы: участник проекта другого шаблона не видит файл шаблона', pg_temp.rows_as(:G, $q$select * from storage.objects where name like '%/t/tplA/guide.pdf'$q$) = 0, true);
select pg_temp.expect('файлы: посторонний не видит файл шаблона', pg_temp.rows_as(:S, $q$select * from storage.objects where name like '%/t/tplA/guide.pdf'$q$) = 0, true);
select pg_temp.expect('файлы: владелец удаляет свой файл', pg_temp.try(:O, $q$delete from storage.objects where name like '%/t/tplA/guide.pdf'$q$), true);
-- ---------- руководители в команде ----------
select pg_temp.expect('руководитель: владелец пишет свои данные', pg_temp.try(:O, $q$select doc_set('data/users/00000000-0000-0000-0000-00000000000a/meta', '{"json":"{}"}')$q$), true);
select pg_temp.expect('руководитель: личная ссылка владельца', pg_temp.try(:O, $q$select doc_set('data/users/00000000-0000-0000-0000-00000000000a/links/joined/px', '{"ownerId":"x"}')$q$), true);
select pg_temp.expect('руководитель: до приглашения не видит данные владельца', pg_temp.rows_as(:L, $q$select * from docs where path = 'data/users/00000000-0000-0000-0000-00000000000a/meta'$q$) = 0, true);
select pg_temp.expect('руководитель: владелец создаёт ссылку руководителя', pg_temp.try(:O, $q$select doc_set('inv/leadcode01', '{"kind":"team","role":"lead","ownerId":"00000000-0000-0000-0000-00000000000a","memberId":"u5"}')$q$), true);
select pg_temp.expect('руководитель: посторонний не создаёт ссылку руководителя от имени владельца', pg_temp.try(:S, $q$select doc_set('inv/leadcode02', '{"kind":"team","role":"lead","ownerId":"00000000-0000-0000-0000-00000000000a"}')$q$), false);
select pg_temp.expect('руководитель: ссылка исполнителя', pg_temp.try(:O, $q$select doc_set('inv/teamcode03', '{"kind":"team","ownerId":"00000000-0000-0000-0000-00000000000a","memberId":"u6"}')$q$), true);
select pg_temp.expect('руководитель: по ссылке исполнителя руководителем не стать', pg_temp.try(:S, $q$select doc_set('team/00000000-0000-0000-0000-00000000000a/managers/00000000-0000-0000-0000-00000000000d', '{"code":"teamcode03"}')$q$), false);
select pg_temp.expect('руководитель: вписывает себя по ссылке руководителя', pg_temp.try(:L, $q$select doc_set('team/00000000-0000-0000-0000-00000000000a/managers/00000000-0000-0000-0000-00000000000f', '{"code":"leadcode01"}')$q$), true);
select pg_temp.expect('руководитель: нельзя вписать другого', pg_temp.try(:L, $q$select doc_set('team/00000000-0000-0000-0000-00000000000a/managers/00000000-0000-0000-0000-00000000000d', '{"code":"leadcode01"}')$q$), false);
select pg_temp.expect('руководитель: читает данные владельца', pg_temp.rows_as(:L, $q$select * from docs where path = 'data/users/00000000-0000-0000-0000-00000000000a/meta'$q$) = 1, true);
select pg_temp.expect('руководитель: пишет проект в данные владельца', pg_temp.try(:L, $q$select doc_set('data/users/00000000-0000-0000-0000-00000000000a/p_x', '{"json":"{}"}')$q$), true);
select pg_temp.expect('руководитель: не видит личные ссылки владельца', pg_temp.rows_as(:L, $q$select * from docs where path like 'data/users/00000000-0000-0000-0000-00000000000a/links/%'$q$) = 0, true);
select pg_temp.expect('руководитель: не пишет в отдельные пространства владельца', pg_temp.try(:L, $q$select doc_set('data/users/00000000-0000-0000-0000-00000000000a/spaces/list/s1', '{"name":"x"}')$q$), false);
select pg_temp.expect('руководитель: посторонний по-прежнему не видит данные владельца', pg_temp.rows_as(:S, $q$select * from docs where path like 'data/users/00000000-0000-0000-0000-00000000000a/%'$q$) = 0, true);
select pg_temp.expect('руководитель: видит общий проект владельца', pg_temp.rows_as(:L, $q$select * from docs where path = 'sp/p1'$q$) = 1, true);
select pg_temp.expect('руководитель: меняет состав участников проекта владельца', pg_temp.try(:L, $q$select doc_update('sp/p1', '{"members":[],"memberIds":[]}')$q$), true);
select pg_temp.expect('руководитель: не забирает проект себе', pg_temp.try(:L, $q$select doc_update('sp/p1', '{"ownerId":"00000000-0000-0000-0000-00000000000f"}')$q$), false);
select pg_temp.expect('руководитель: создаёт общий проект от имени владельца', pg_temp.try(:L, $q$select doc_set('sp/pL', '{"ownerId":"00000000-0000-0000-0000-00000000000a","members":[],"memberIds":[],"json":"{}"}')$q$), true);
select pg_temp.expect('руководитель: ссылка в проект от имени владельца', pg_temp.try(:L, $q$select doc_set('inv/projcodeL1', '{"pid":"p1","ownerId":"00000000-0000-0000-0000-00000000000a","role":"worker"}')$q$), true);
select pg_temp.expect('руководитель: приглашает исполнителя в команду владельца', pg_temp.try(:L, $q$select doc_set('inv/teamcodeL1', '{"kind":"team","ownerId":"00000000-0000-0000-0000-00000000000a","memberId":"u7"}')$q$), true);
select pg_temp.expect('руководитель: не приглашает новых руководителей', pg_temp.try(:L, $q$select doc_set('inv/leadcodeL1', '{"kind":"team","role":"lead","ownerId":"00000000-0000-0000-0000-00000000000a"}')$q$), false);
select pg_temp.expect('руководитель: посторонний не создаёт проект от имени владельца', pg_temp.try(:S, $q$select doc_set('sp/pS', '{"ownerId":"00000000-0000-0000-0000-00000000000a","json":"{}"}')$q$), false);
select pg_temp.expect('руководитель: файл владельца виден', pg_temp.rows_as(:L, $q$select * from storage.objects where name like '00000000-0000-0000-0000-00000000000a/%'$q$) >= 1, true);
select pg_temp.expect('руководитель: загружает файл', pg_temp.try(:L, $q$insert into storage.objects (bucket_id, name) values ('kz-files', '00000000-0000-0000-0000-00000000000f/p/pz/f.pdf')$q$), true);
select pg_temp.expect('руководитель: владелец видит файл руководителя', pg_temp.rows_as(:O, $q$select * from storage.objects where name = '00000000-0000-0000-0000-00000000000f/p/pz/f.pdf'$q$) = 1, true);
select pg_temp.expect('руководитель: посторонний не видит файл руководителя', pg_temp.rows_as(:S, $q$select * from storage.objects where name = '00000000-0000-0000-0000-00000000000f/p/pz/f.pdf'$q$) = 0, true);
select pg_temp.expect('руководитель: владелец убирает руководителя', pg_temp.try(:O, $q$select doc_delete('team/00000000-0000-0000-0000-00000000000a/managers/00000000-0000-0000-0000-00000000000f')$q$), true);
select pg_temp.expect('руководитель: после этого данных владельца не видит', pg_temp.rows_as(:L, $q$select * from docs where path like 'data/users/00000000-0000-0000-0000-00000000000a/%'$q$) = 0, true);
select pg_temp.expect('руководитель: и писать не может', pg_temp.try(:L, $q$select doc_set('data/users/00000000-0000-0000-0000-00000000000a/p_y', '{"json":"{}"}')$q$), false);
select pg_temp.expect('без входа ничего не читается', pg_temp.rows_as('', $q$select * from docs$q$) = 0, true);

select (case when ok then 'PASS ' else 'FAIL ' end) || name from results;
select count(*) filter (where ok) || ' из ' || count(*) || ' проверок базы прошло' as total, bool_and(ok) as all_ok from results \gset
\echo :total
rollback;
\if :all_ok
\else
  \echo 'ЕСТЬ ОШИБКИ'
  select 1/0;
\endif
