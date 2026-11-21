-- Диалог с ботом: голосовое → бот присылает список задач → правки текстом/голосом → «ок» → задачи сразу в «К выполнению».
--   • tg_links.ctx — что бот должен знать о пространстве: отделы, люди (с ролями), уже существующие задачи (против повторов).
--     Пишет само приложение владельца (tg_link_ctx), читает сервер (tg_ctx, по секрету).
--   • app_private.tg_drafts — черновик списка задач в чате, пока его не подтвердили. Доступ только у сервера (по секрету).
--   • tg_drop_tasks — подтверждённые задачи в data/users/<владелец>/tgdrops/<id> с полем tasks; приложение ставит их на доску.

alter table public.tg_links add column if not exists ctx jsonb;

-- приложение владельца обновляет контекст своих каналов (только своих строк — RLS tg_links_own)
create or replace function public.tg_link_ctx(p_kind text, p_pid text, p_ctx jsonb) returns void
language plpgsql security invoker set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_granted' using errcode = '42501'; end if;
  if pg_column_size(p_ctx) > 200000 then raise exception 'too_large' using errcode = '54000'; end if;
  update public.tg_links set ctx = p_ctx
   where owner = auth.uid() and chat_id is not null and kind = coalesce(p_kind, 'info')
     and (pid is not distinct from p_pid or (coalesce(p_kind, 'info') = 'info' and pid is null));
end $$;
grant update (ctx) on public.tg_links to authenticated;
grant execute on function public.tg_link_ctx(text, text, jsonb) to authenticated;

create table if not exists app_private.tg_drafts (
  chat_id    bigint primary key,
  tasks      jsonb not null default '[]'::jsonb,
  msg_id     bigint,
  updated_at timestamptz not null default now()
);
alter table app_private.tg_drafts enable row level security;   -- без политик: только функции базы

create or replace function app_private.tg_secret_ok(p_secret text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_secret is not null and p_secret = (select value from app_private.tg_config where key = 'secret');
$$;

-- сервер: контекст канала (отделы, люди, задачи) — null, если канал не подключён
create or replace function public.tg_ctx(p_secret text, p_chat bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare l public.tg_links;
begin
  if not app_private.tg_secret_ok(p_secret) then raise exception 'not_granted' using errcode = '42501'; end if;
  select * into l from public.tg_links where chat_id = p_chat;
  if not found then return null; end if;
  return jsonb_build_object('kind', l.kind, 'ctx', coalesce(l.ctx, '{}'::jsonb));
end $$;

-- сервер: черновик (прочитать / записать / удалить)
create or replace function public.tg_draft_get(p_secret text, p_chat bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d app_private.tg_drafts;
begin
  if not app_private.tg_secret_ok(p_secret) then raise exception 'not_granted' using errcode = '42501'; end if;
  select * into d from app_private.tg_drafts where chat_id = p_chat and updated_at > now() - interval '2 days';
  if not found then return null; end if;
  return jsonb_build_object('tasks', d.tasks, 'msg_id', d.msg_id);
end $$;

create or replace function public.tg_draft_set(p_secret text, p_chat bigint, p_tasks jsonb, p_msg bigint) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not app_private.tg_secret_ok(p_secret) then raise exception 'not_granted' using errcode = '42501'; end if;
  if not exists (select 1 from public.tg_links where chat_id = p_chat) then return false; end if;
  if p_tasks is null then
    delete from app_private.tg_drafts where chat_id = p_chat;
  else
    insert into app_private.tg_drafts (chat_id, tasks, msg_id, updated_at) values (p_chat, p_tasks, p_msg, now())
    on conflict (chat_id) do update set tasks = excluded.tasks, msg_id = coalesce(excluded.msg_id, app_private.tg_drafts.msg_id), updated_at = now();
  end if;
  return true;
end $$;

-- сервер: подтверждённые задачи — владельцу канала, приложение поставит их в «К выполнению»
create or replace function public.tg_drop_tasks(p_secret text, p_chat bigint, p_tasks jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
declare l public.tg_links; id text := replace(gen_random_uuid()::text, '-', '');
begin
  if not app_private.tg_secret_ok(p_secret) then raise exception 'not_granted' using errcode = '42501'; end if;
  select * into l from public.tg_links where chat_id = p_chat;
  if not found or jsonb_typeof(p_tasks) <> 'array' or jsonb_array_length(p_tasks) = 0 then return false; end if;
  insert into public.docs (path, data)
  values ('data/users/' || l.owner::text || '/tgdrops/' || id,
          jsonb_build_object('tasks', p_tasks, 'kind', l.kind, 'pid', l.pid, 'chat', l.chat_title, 'at', now()));
  delete from app_private.tg_drafts where chat_id = p_chat;
  return true;
end $$;

revoke all on function app_private.tg_secret_ok(text) from public;
revoke all on function public.tg_ctx(text, bigint) from public;
revoke all on function public.tg_draft_get(text, bigint) from public;
revoke all on function public.tg_draft_set(text, bigint, jsonb, bigint) from public;
revoke all on function public.tg_drop_tasks(text, bigint, jsonb) from public;
grant execute on function public.tg_ctx(text, bigint) to anon, authenticated;
grant execute on function public.tg_draft_get(text, bigint) to anon, authenticated;
grant execute on function public.tg_draft_set(text, bigint, jsonb, bigint) to anon, authenticated;
grant execute on function public.tg_drop_tasks(text, bigint, jsonb) to anon, authenticated;
