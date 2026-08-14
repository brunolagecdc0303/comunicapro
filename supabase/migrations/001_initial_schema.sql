-- ComunicaPro - Schema Inicial
-- Supabase PostgreSQL

-- Extensões
create extension if not exists "pg_cron" with schema "extensions";
create extension if not exists "uuid-ossp";

-- ============================================
-- CONTATOS
-- ============================================
create table public.contacts (
  id uuid primary key default uuid_generate_v4(),
  team_id uuid not null,
  name text not null,
  phone text not null,
  email text,
  tags text[] default '{}',
  metadata jsonb default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  created_by uuid references auth.users(id),
  unique(team_id, phone)
);

create index idx_contacts_team on public.contacts(team_id);
create index idx_contacts_phone on public.contacts(phone);
create index idx_contacts_tags on public.contacts using gin(tags);

-- ============================================
-- GRUPOS DE CONTATOS
-- ============================================
create table public.contact_groups (
  id uuid primary key default uuid_generate_v4(),
  team_id uuid not null,
  name text not null,
  description text,
  created_at timestamptz default now(),
  created_by uuid references auth.users(id)
);

create table public.contact_group_members (
  group_id uuid references public.contact_groups(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete cascade,
  primary key (group_id, contact_id)
);

-- ============================================
-- TEMPLATES DE MENSAGENS
-- ============================================
create table public.message_templates (
  id uuid primary key default uuid_generate_v4(),
  team_id uuid not null,
  name text not null,
  content text not null,
  media_url text,
  media_type text, -- 'image', 'document', 'video'
  ai_generated boolean default false,
  ai_prompt text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  created_by uuid references auth.users(id)
);

-- ============================================
-- CAMPANHAS (envios em massa)
-- ============================================
create table public.campaigns (
  id uuid primary key default uuid_generate_v4(),
  team_id uuid not null,
  name text not null,
  template_id uuid references public.message_templates(id),
  status text default 'draft' check (status in ('draft', 'scheduled', 'running', 'completed', 'paused', 'failed')),
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  total_recipients int default 0,
  sent_count int default 0,
  failed_count int default 0,
  delay_seconds int default 5, -- delay entre mensagens (evitar bloqueio)
  created_at timestamptz default now(),
  created_by uuid references auth.users(id)
);

-- ============================================
-- FILA DE MENSAGENS
-- ============================================
create table public.message_queue (
  id uuid primary key default uuid_generate_v4(),
  campaign_id uuid references public.campaigns(id) on delete cascade,
  contact_id uuid references public.contacts(id),
  phone text not null,
  content text not null,
  media_url text,
  status text default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
  scheduled_at timestamptz default now(),
  sent_at timestamptz,
  error_message text,
  wasender_response jsonb,
  created_at timestamptz default now()
);

create index idx_queue_status on public.message_queue(status, scheduled_at);
create index idx_queue_campaign on public.message_queue(campaign_id);

-- ============================================
-- HISTÓRICO / LOG
-- ============================================
create table public.message_log (
  id uuid primary key default uuid_generate_v4(),
  team_id uuid not null,
  campaign_id uuid,
  contact_phone text,
  contact_name text,
  content text,
  direction text default 'outbound' check (direction in ('outbound', 'inbound')),
  status text,
  sent_at timestamptz default now(),
  metadata jsonb default '{}'
);

create index idx_log_team on public.message_log(team_id, sent_at desc);

-- ============================================
-- TIMES (multi-user)
-- ============================================
create table public.teams (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  owner_id uuid references auth.users(id),
  wasender_api_key text, -- criptografado no app
  gemini_api_key text,
  settings jsonb default '{"delay_between_messages": 5, "daily_limit": 500}',
  created_at timestamptz default now()
);

create table public.team_members (
  team_id uuid references public.teams(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  role text default 'member' check (role in ('owner', 'admin', 'member')),
  primary key (team_id, user_id)
);

-- ============================================
-- PDFs para IA
-- ============================================
create table public.pdf_library (
  id uuid primary key default uuid_generate_v4(),
  team_id uuid not null,
  name text not null,
  file_url text not null, -- Supabase Storage URL
  file_size int,
  extracted_text text, -- texto extraído para feed da IA
  created_at timestamptz default now(),
  created_by uuid references auth.users(id)
);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
alter table public.contacts enable row level security;
alter table public.contact_groups enable row level security;
alter table public.campaigns enable row level security;
alter table public.message_queue enable row level security;
alter table public.message_log enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.message_templates enable row level security;
alter table public.pdf_library enable row level security;

-- Política: usuários veem dados do próprio time
create policy "team_access" on public.contacts
  for all using (
    team_id in (select team_id from public.team_members where user_id = auth.uid())
  );

create policy "team_access" on public.contact_groups
  for all using (
    team_id in (select team_id from public.team_members where user_id = auth.uid())
  );

create policy "team_access" on public.campaigns
  for all using (
    team_id in (select team_id from public.team_members where user_id = auth.uid())
  );

create policy "team_access" on public.message_queue
  for all using (
    campaign_id in (
      select id from public.campaigns where team_id in (
        select team_id from public.team_members where user_id = auth.uid()
      )
    )
  );

create policy "team_access" on public.message_log
  for all using (
    team_id in (select team_id from public.team_members where user_id = auth.uid())
  );

create policy "team_access" on public.teams
  for all using (
    id in (select team_id from public.team_members where user_id = auth.uid())
  );

create policy "team_access" on public.team_members
  for all using (
    user_id = auth.uid() or
    team_id in (select team_id from public.team_members where user_id = auth.uid())
  );

create policy "team_access" on public.message_templates
  for all using (
    team_id in (select team_id from public.team_members where user_id = auth.uid())
  );

create policy "team_access" on public.pdf_library
  for all using (
    team_id in (select team_id from public.team_members where user_id = auth.uid())
  );

-- ============================================
-- CRON: processar fila a cada minuto
-- ============================================
-- Isso será configurado via Supabase Dashboard ou pg_cron
-- select cron.schedule(
--   'process-message-queue',
--   '* * * * *',
--   $$select net.http_post(
--     'https://SEU_PROJECT.supabase.co/functions/v1/send-messages',
--     '{}',
--     'application/json',
--     ARRAY[http_header('Authorization', 'Bearer SEU_SERVICE_KEY')]
--   )$$
-- );

-- ============================================
-- FUNCTIONS auxiliares
-- ============================================
create or replace function public.update_campaign_counts()
returns trigger as $$
begin
  update public.campaigns set
    sent_count = (select count(*) from public.message_queue where campaign_id = NEW.campaign_id and status = 'sent'),
    failed_count = (select count(*) from public.message_queue where campaign_id = NEW.campaign_id and status = 'failed')
  where id = NEW.campaign_id;
  return NEW;
end;
$$ language plpgsql;

create trigger trg_update_campaign_counts
after update of status on public.message_queue
for each row execute function public.update_campaign_counts();
