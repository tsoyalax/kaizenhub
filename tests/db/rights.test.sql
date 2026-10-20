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
  ('00000000-0000-0000-0000-00000000000e', 't@x.y', '{"name":"Team T","avatar_url":"https://img/t.png"}');

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
