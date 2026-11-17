-- Trackr cloud schema (OPTIONAL). The app works fully on-device without it.
-- It adds: account sync across devices, email reminders, a shared parse cache.
-- NOT wired into the client yet: see README "What is real and what is not".

create extension if not exists pgcrypto;

create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  email text, name text, country text, tz text default 'Africa/Lagos',
  remind_days int[] default '{14,7,3,1}', email_reminders boolean default true,
  consent_at timestamptz, created_at timestamptz default now()
);

-- One row per user, holding the whole synced tracker as JSON (simple and conflict-checked by version).
create table if not exists tracker_state (
  user_id uuid primary key references auth.users on delete cascade,
  version bigint not null default 0,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

-- Flattened deadlines the reminder job reads (kept in sync by the client on save).
create table if not exists reminder_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  application_id text not null,
  title text not null,
  due_on date not null,
  due_time time, due_tz text,
  status text not null default 'saved',
  url text,
  unique (user_id, application_id, due_on)
);
create index if not exists reminder_items_due on reminder_items (due_on);

create table if not exists reminder_log (
  user_id uuid, application_id text, due_on date, days_before int, sent_at timestamptz default now(),
  primary key (user_id, application_id, due_on, days_before)
);

-- Parsed-page cache shared across users, so a viral post is read once.
create table if not exists source_cache (
  url_hash text primary key, canonical_url text, result jsonb not null, fetched_at timestamptz default now()
);

alter table profiles enable row level security;
alter table tracker_state enable row level security;
alter table reminder_items enable row level security;
alter table reminder_log enable row level security;
alter table source_cache enable row level security;

create policy "own profile" on profiles for all using (auth.uid() = id) with check (auth.uid() = id);
create policy "own state" on tracker_state for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own reminders" on reminder_items for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- reminder_log and source_cache are touched only by the service role (no policies = no client access).

-- Used by netlify/functions/send-reminders.mts (service role). Returns reminders to email today.
create or replace function due_reminders(today date)
returns table (user_id uuid, email text, name text, application_id text, title text, due_on date, days_before int, url text)
language sql security definer as $$
  select r.user_id, p.email, p.name, r.application_id, r.title, r.due_on, (r.due_on - today) as days_before, r.url
  from reminder_items r join profiles p on p.id = r.user_id
  where p.email_reminders and p.email is not null
    and r.status in ('saved','preparing')
    and (r.due_on - today) = any (p.remind_days)
    and not exists (select 1 from reminder_log l where l.user_id = r.user_id and l.application_id = r.application_id and l.due_on = r.due_on and l.days_before = (r.due_on - today));
$$;

-- Weekly digest: open items closing in the next 7 days, per user.
create or replace function weekly_digest(today date)
returns table (user_id uuid, email text, name text, items jsonb)
language sql security definer as $$
  select r.user_id, p.email, p.name, jsonb_agg(jsonb_build_object('title', r.title, 'due_on', r.due_on, 'url', r.url) order by r.due_on)
  from reminder_items r join profiles p on p.id = r.user_id
  where p.email_reminders and p.email is not null and r.status in ('saved','preparing') and r.due_on between today and today + 7
  group by r.user_id, p.email, p.name;
$$;
