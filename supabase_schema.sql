-- ============================================================================
-- HUE STASIE SUPABASE MIGRATION SCHEMA
-- ============================================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- 1. IDENTITIES TABLE
create table if not exists public.identities (
  id uuid default uuid_generate_v4() primary key,
  name text not null unique,
  letter text not null,
  color text not null,
  greeting text,
  emoji text,
  role text,
  instagram text,
  facebook text,
  created_at timestamptz default timezone('utc'::text, now()) not null
);

-- 2. PROJECTS TABLE
create table if not exists public.projects (
  id text primary key,
  name text not null,
  identity text not null,
  status text not null default 'pending',
  priority text not null default 'normal',
  next_action text,
  notes text,
  workload numeric default 0,
  created_at timestamptz default timezone('utc'::text, now()) not null,
  updated_at timestamptz default timezone('utc'::text, now()) not null
);

-- 3. SUBTASKS TABLE
create table if not exists public.subtasks (
  id text primary key,
  project_id text references public.projects(id) on delete cascade not null,
  text text not null,
  done boolean default false not null,
  created_at timestamptz default timezone('utc'::text, now()) not null
);

-- 4. EVENTS TABLE
create table if not exists public.events (
  id text primary key,
  title text not null,
  date text not null,
  time text,
  identity text,
  color text,
  notes text,
  created_at timestamptz default timezone('utc'::text, now()) not null
);

-- 5. TALENT CATEGORIES AND RECORDS
create table if not exists public.talent_categories (
  key text primary key,
  label text not null
);

create table if not exists public.talent_members (
  id text primary key,
  category_key text references public.talent_categories(key) on delete cascade not null,
  name text not null,
  instagram text,
  note text,
  created_at timestamptz default timezone('utc'::text, now()) not null
);

-- 6. APP STATE & SYNC METADATA
create table if not exists public.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz default timezone('utc'::text, now()) not null
);

-- Row Level Security (RLS) Policies
alter table public.identities enable row level security;
alter table public.projects enable row level security;
alter table public.subtasks enable row level security;
alter table public.events enable row level security;
alter table public.talent_categories enable row level security;
alter table public.talent_members enable row level security;
alter table public.app_settings enable row level security;

-- Allow authenticated agency users full access
create policy "Allow authenticated agency access to identities" on public.identities for all using (auth.role() = 'authenticated');
create policy "Allow authenticated agency access to projects" on public.projects for all using (auth.role() = 'authenticated');
create policy "Allow authenticated agency access to subtasks" on public.subtasks for all using (auth.role() = 'authenticated');
create policy "Allow authenticated agency access to events" on public.events for all using (auth.role() = 'authenticated');
create policy "Allow authenticated agency access to talent_categories" on public.talent_categories for all using (auth.role() = 'authenticated');
create policy "Allow authenticated agency access to talent_members" on public.talent_members for all using (auth.role() = 'authenticated');
create policy "Allow authenticated agency access to app_settings" on public.app_settings for all using (auth.role() = 'authenticated');

-- Seed default identities
insert into public.identities (name, letter, color, greeting, emoji, role, instagram, facebook)
values 
  ('Housing Hues', 'H', '#ff9500', 'Good day, Housing Hues commander', '🎨', 'Creative Agency Operations', 'https://www.instagram.com/housinghues', ''),
  ('018 Productions', '0', '#ff3b3b', 'Fede Whuzet', '🎬', 'Creative Director', 'https://www.instagram.com/018productions', '')
on conflict (name) do nothing;

insert into public.talent_categories (key, label) values ('models', 'Models & Editorial') on conflict (key) do nothing;
