-- =====================================================================
--  Аналитика Reels-воронки (/funnel): периоды с цифрами воронки и РНП.
--  Каждый человек видит и меняет только свои периоды.
-- =====================================================================

create table public.funnel_periods (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  label        text not null check (length(label) between 1 and 60),
  dates        text not null default '' check (length(dates) <= 60),
  stage_values jsonb not null default '{}'::jsonb,
  sales        jsonb not null default '{}'::jsonb,
  extra        jsonb not null default '{}'::jsonb,
  rnp          text not null default '' check (length(rnp) <= 50000),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index funnel_periods_user_idx on public.funnel_periods (user_id, created_at);

create or replace function app_private.funnel_periods_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.user_id    := old.user_id;
  return new;
end $$;

create trigger funnel_periods_touch before update on public.funnel_periods
  for each row execute function app_private.funnel_periods_touch();

alter table public.funnel_periods enable row level security;

create policy funnel_periods_select on public.funnel_periods
  for select to authenticated using (user_id = auth.uid());
create policy funnel_periods_insert on public.funnel_periods
  for insert to authenticated with check (user_id = auth.uid());
create policy funnel_periods_update on public.funnel_periods
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy funnel_periods_delete on public.funnel_periods
  for delete to authenticated using (user_id = auth.uid());

grant select, insert, update, delete on public.funnel_periods to authenticated;
