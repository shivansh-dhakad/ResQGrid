create extension if not exists "pgcrypto";
create extension if not exists "uuid-ossp";

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  auth_id uuid unique, -- keep if you use it; login is currently mapped to id

  full_name text,
  display_name text,
  email text unique,
  phone text,
  user_type text not null default 'individual', -- individual | ngo

  org_name text,
  org_type text,
  org_reg_number text,

  is_verified boolean not null default false,
  is_admin boolean not null default false,
  is_suspended boolean not null default false,

  score integer not null default 0,
  badge text not null default 'New Helper',
  emergencies_helped integer not null default 0,
  resources_listed integer not null default 0,

  city text,
  state_region text,
  lat double precision,
  lng double precision,

  created_at timestamptz not null default now()
);

-- ===============
-- Emergencies
-- ===============
create table if not exists public.emergencies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,

  title text not null,
  description text not null,
  category text not null default 'other',

  risk_level text not null default 'medium',
  risk_reason text,
  is_anonymous boolean not null default false,

  lat double precision not null,
  lng double precision not null,
  geohash text,

  blood_group text,

  status text not null default 'active', -- active | resolved

  created_at timestamptz not null default now()
);

create index if not exists emergencies_status_idx on public.emergencies(status);
create index if not exists emergencies_user_id_idx on public.emergencies(user_id);

-- =================
-- Responders
-- =================
create table if not exists public.responders (
  id uuid primary key default gen_random_uuid(),
  emergency_id uuid not null references public.emergencies(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  status text not null default 'responding',
  lat double precision,
  lng double precision,
  created_at timestamptz not null default now(),
  unique (emergency_id, user_id)
);

create index if not exists responders_emergency_id_idx on public.responders(emergency_id);
create index if not exists responders_user_id_idx on public.responders(user_id);

-- =================
-- Messages
-- =================
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  emergency_id uuid not null references public.emergencies(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  content text not null,
  display_name text,
  created_at timestamptz not null default now()
);

create index if not exists messages_emergency_id_idx on public.messages(emergency_id);

-- =================
-- Resources
-- =================
create table if not exists public.resources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,

  type text not null, -- blood | food | shelter | transport | medicine | equipment
  title text not null,
  description text,

  quantity numeric,
  blood_group text,
  available_until timestamptz,

  lat double precision not null,
  lng double precision not null,
  geohash text,

  is_available boolean not null default true,

  created_at timestamptz not null default now()
);

create index if not exists resources_type_idx on public.resources(type);
create index if not exists resources_is_available_idx on public.resources(is_available);
create index if not exists resources_user_id_idx on public.resources(user_id);

-- =================
-- Private Resource Conversations
-- =================
create table if not exists public.resource_threads (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.resources(id) on delete cascade,
  owner_id uuid not null references public.users(id) on delete cascade,
  requester_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (resource_id, requester_id),
  check (owner_id <> requester_id)
);

create index if not exists resource_threads_owner_id_idx on public.resource_threads(owner_id);
create index if not exists resource_threads_requester_id_idx on public.resource_threads(requester_id);
create index if not exists resource_threads_resource_id_idx on public.resource_threads(resource_id);

create table if not exists public.resource_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.resource_threads(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  content text not null,
  display_name text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists resource_messages_thread_id_idx on public.resource_messages(thread_id);
create index if not exists resource_messages_user_id_idx on public.resource_messages(user_id);
create index if not exists resource_messages_read_at_idx on public.resource_messages(read_at);

-- =================
-- SOS Events
-- =================
create table if not exists public.sos_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  geohash text,

  is_active boolean not null default true,
  cancelled_within_60s boolean not null default false,

  created_at timestamptz not null default now()
);

create index if not exists sos_events_active_idx on public.sos_events(is_active);

-- =================
-- SOS Contacts
-- =================
create table if not exists public.sos_contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  contact_user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, contact_user_id)
);

create index if not exists sos_contacts_user_id_idx on public.sos_contacts(user_id);

-- =================
-- Ngo Memberships
-- =================
create table if not exists public.ngo_memberships (
  id uuid primary key default gen_random_uuid(),
  ngo_id uuid not null references public.users(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  status text not null default 'pending', -- pending | approved | rejected
  created_at timestamptz not null default now(),
  unique (ngo_id, user_id)
);

create index if not exists ngo_memberships_ngo_id_idx on public.ngo_memberships(ngo_id);

-- =================
-- Reports
-- =================
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reported_by uuid references public.users(id) on delete set null,
  emergency_id uuid references public.emergencies(id) on delete cascade,
  reported_user uuid references public.users(id) on delete set null,

  reason text not null,
  description text,

  status text not null default 'pending',
  created_at timestamptz not null default now()
);

create index if not exists reports_status_idx on public.reports(status);
create index if not exists reports_emergency_id_idx on public.reports(emergency_id);

-- =================
-- Activity Log (admin panel)
-- =================
create table if not exists public.activity_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  action text not null,
  lat double precision,
  lng double precision,
  created_at timestamptz not null default now()
);

-- ======================
-- RLS (Row Level Security)
-- ======================
-- Enable RLS on user-facing tables.
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emergencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.responders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resource_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resource_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sos_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sos_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ngo_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;



-- USERS
create policy "users_select_own" on public.users
  for select using (id = auth.uid());

-- create policy "users_update_own" on public.users
--   for update using (id = auth.uid()) with check (id = auth.uid());

-- ADMIN routes in backend rely on service role; policies mainly matter for client.
-- Still allow client read access if you want.
-- If you want public profile access, add select policy for limited fields.

-- EMERGENCIES
create policy "emergencies_select_active" on public.emergencies
  for select using (status = 'active');

create policy "emergencies_insert_own" on public.emergencies
  for insert with check (user_id = auth.uid());

create policy "emergencies_update_own" on public.emergencies
  for update using (user_id = auth.uid());

-- RESPONDERS
create policy "responders_select_any" on public.responders
  for select using (true);

create policy "responders_insert_own" on public.responders
  for insert with check (user_id = auth.uid());

-- MESSAGES
create policy "messages_select_any" on public.messages
  for select using (true);

create policy "messages_insert_own" on public.messages
  for insert with check (user_id = auth.uid());

-- RESOURCES
create policy "resources_select_available" on public.resources
  for select using (is_available = true);

create policy "resources_insert_own" on public.resources
  for insert with check (user_id = auth.uid());

create policy "resources_update_own" on public.resources
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- RESOURCE THREADS
create policy "resource_threads_select_participants" on public.resource_threads
  for select using (owner_id = auth.uid() or requester_id = auth.uid());

create policy "resource_threads_insert_requester" on public.resource_threads
  for insert with check (requester_id = auth.uid());

create policy "resource_threads_update_participants" on public.resource_threads
  for update using (owner_id = auth.uid() or requester_id = auth.uid());

-- RESOURCE MESSAGES
create policy "resource_messages_select_participants" on public.resource_messages
  for select using (
    exists (
      select 1 from public.resource_threads rt
      where rt.id = thread_id
      and (rt.owner_id = auth.uid() or rt.requester_id = auth.uid())
    )
  );

create policy "resource_messages_insert_participants" on public.resource_messages
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.resource_threads rt
      where rt.id = thread_id
      and (rt.owner_id = auth.uid() or rt.requester_id = auth.uid())
    )
  );

-- create policy "resource_messages_update_recipient_read" on public.resource_messages
--   for update using (
--     exists (
--       select 1 from public.resource_threads rt
--       where rt.id = thread_id
--       and (rt.owner_id = auth.uid() or rt.requester_id = auth.uid())
--     )
--   );

-- SOS Events
create policy "sos_select_active" on public.sos_events
  for select using (is_active = true);

create policy "sos_insert_own" on public.sos_events
  for insert with check (user_id = auth.uid());

create policy "sos_update_own" on public.sos_events
  for update using (user_id = auth.uid());

-- SOS Contacts
create policy "sos_contacts_select_own" on public.sos_contacts
  for select using (user_id = auth.uid());

create policy "sos_contacts_insert_own" on public.sos_contacts
  for insert with check (user_id = auth.uid());

create policy "sos_contacts_delete_own" on public.sos_contacts
  for delete using (user_id = auth.uid());

-- NGO Memberships
create policy "ngo_memberships_select_any" on public.ngo_memberships
  for select using (true);

create policy "ngo_memberships_insert_own" on public.ngo_memberships
  for insert with check (user_id = auth.uid());

-- Reports
create policy "reports_insert_own" on public.reports
  for insert with check (reported_by = auth.uid());

-- create policy "reports_select_pending" on public.reports
--   for select using (status = 'pending');

-- Activity log (admin)
create policy "activity_log_insert_own" on public.activity_log
  for insert with check (user_id = auth.uid());

create policy "activity_log_select_admin" on public.activity_log
  for select using (false);

