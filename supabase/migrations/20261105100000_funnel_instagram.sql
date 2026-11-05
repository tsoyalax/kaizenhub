-- =====================================================================
--  Аналитика Reels-воронки (/funnel): подключённый Instagram и его ролики.
--  Токен Instagram хранится зашифрованным (ключ — в Vercel, проект analitika),
--  поэтому даже владелец строки видит только шифротекст.
-- =====================================================================

create table public.instagram_connections (
  user_id          uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  ig_user_id       text not null,
  username         text not null,
  account_type     text not null default '',
  token_enc        text not null,
  token_expires_at timestamptz not null,
  keyword          text not null default 'активы' check (length(keyword) between 1 and 60),
  synced_at        timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table public.instagram_media (
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  media_id      text not null,
  caption       text not null default '',
  media_type    text not null default '',
  product_type  text not null default '',
  permalink     text not null default '',
  thumbnail_url text not null default '',
  posted_at     timestamptz,
  views         integer,
  reach         integer,
  likes         integer,
  comments      integer,
  saved         integer,
  shares        integer,
  fetched_at    timestamptz not null default now(),
  primary key (user_id, media_id)
);
create index instagram_media_posted_idx on public.instagram_media (user_id, posted_at desc);

create or replace function app_private.instagram_connections_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.user_id    := old.user_id;
  return new;
end $$;

create trigger instagram_connections_touch before update on public.instagram_connections
  for each row execute function app_private.instagram_connections_touch();

alter table public.instagram_connections enable row level security;
alter table public.instagram_media enable row level security;

create policy instagram_connections_own on public.instagram_connections
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy instagram_media_own on public.instagram_media
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.instagram_connections to authenticated;
grant select, insert, update, delete on public.instagram_media to authenticated;
