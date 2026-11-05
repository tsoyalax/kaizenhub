-- =====================================================================
--  Аналитика Reels-воронки (/funnel): настройки продукта — ссылка на сайт
--  продаж, описание и тарифы с ценами (из них считается средний чек).
--  Одна строка на человека, видит и меняет только свою.
-- =====================================================================

create table public.funnel_settings (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  product    jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create or replace function app_private.funnel_settings_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.user_id    := old.user_id;
  return new;
end $$;

create trigger funnel_settings_touch before update on public.funnel_settings
  for each row execute function app_private.funnel_settings_touch();

alter table public.funnel_settings enable row level security;

create policy funnel_settings_own on public.funnel_settings
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.funnel_settings to authenticated;
