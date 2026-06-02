-- ============================================================
-- NIHONGO FLASH — Supabase Schema + RLS
-- Jalankan seluruh file ini di Supabase Dashboard → SQL Editor → Run
-- ============================================================

-- ---------- TABEL: profiles ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text not null default '',
  created_at  timestamptz not null default now()
);

-- ---------- TABEL: categories ----------
create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists categories_user_idx on public.categories(user_id);

-- ---------- TABEL: flashcards ----------
create table if not exists public.flashcards (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  category_id uuid references public.categories(id) on delete cascade,
  kanji       text not null,
  reading     text default '',
  meaning     text default '',
  status      text not null default 'belum_hafal'
              check (status in ('belum_hafal','hafal')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists flashcards_user_idx on public.flashcards(user_id);
create index if not exists flashcards_cat_idx  on public.flashcards(category_id);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table public.profiles   enable row level security;
alter table public.categories enable row level security;
alter table public.flashcards enable row level security;

-- ---------- profiles ----------
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- ---------- categories ----------
drop policy if exists "categories_select_own" on public.categories;
create policy "categories_select_own" on public.categories
  for select using (auth.uid() = user_id);

drop policy if exists "categories_insert_own" on public.categories;
create policy "categories_insert_own" on public.categories
  for insert with check (auth.uid() = user_id);

drop policy if exists "categories_update_own" on public.categories;
create policy "categories_update_own" on public.categories
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "categories_delete_own" on public.categories;
create policy "categories_delete_own" on public.categories
  for delete using (auth.uid() = user_id);

-- ---------- flashcards ----------
drop policy if exists "flashcards_select_own" on public.flashcards;
create policy "flashcards_select_own" on public.flashcards
  for select using (auth.uid() = user_id);

drop policy if exists "flashcards_insert_own" on public.flashcards;
create policy "flashcards_insert_own" on public.flashcards
  for insert with check (auth.uid() = user_id);

drop policy if exists "flashcards_update_own" on public.flashcards;
create policy "flashcards_update_own" on public.flashcards
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "flashcards_delete_own" on public.flashcards;
create policy "flashcards_delete_own" on public.flashcards
  for delete using (auth.uid() = user_id);

-- ============================================================
-- TRIGGER: buat profil otomatis saat user baru mendaftar
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name',
             new.raw_user_meta_data->>'full_name',
             split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- (Opsional) updated_at otomatis pada flashcards
-- ============================================================
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

drop trigger if exists flashcards_touch on public.flashcards;
create trigger flashcards_touch
  before update on public.flashcards
  for each row execute function public.touch_updated_at();
