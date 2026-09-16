-- ComunicaPro - Grupos familiares/empresariais e rascunhos de mensagem
--
-- 1) client_groups: uma pessoa toma conta de várias contas.
--    O titular (primary_contact_id) é quem RECEBE a mensagem; os membros são
--    as contas cujos PDFs vão anexados. Uma mensagem só, vários documentos.
--
-- 2) message_drafts: as mensagens geradas e editadas passam a sobreviver ao
--    fechar a aba. Antes viviam só no estado do React.

-- ============================================
-- GRUPOS
-- ============================================
create table if not exists public.client_groups (
  id uuid primary key default uuid_generate_v4(),
  team_id uuid not null references public.teams(id) on delete cascade,
  name text not null,                 -- ex.: "Família Ribeiro", "Grupo Martins"
  kind text not null default 'familia' check (kind in ('familia', 'empresa')),

  -- Quem recebe no WhatsApp. Se o contato for excluído o grupo fica órfão de
  -- titular em vez de sumir — daí o set null, para não perder a composição.
  primary_contact_id uuid references public.contacts(id) on delete set null,

  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create index if not exists idx_client_groups_team on public.client_groups(team_id);

-- Contas que compõem o grupo. O titular também deve constar aqui se a conta
-- dele entra no envio — são papéis diferentes (quem recebe x quais contas).
create table if not exists public.client_group_members (
  group_id uuid not null references public.client_groups(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  primary key (group_id, contact_id)
);

create index if not exists idx_group_members_contact on public.client_group_members(contact_id);

-- ============================================
-- RASCUNHOS
-- ============================================
-- items guarda a lista revisada:
--   [{ "contact_id": "...", "group_id": null, "name": "...", "phone": "...",
--      "message": "...", "pdf_ids": ["..."] }]
-- Guardar o texto final (já editado) é o ponto: é ele que o assessor revisou.
create table if not exists public.message_drafts (
  id uuid primary key default uuid_generate_v4(),
  team_id uuid not null references public.teams(id) on delete cascade,
  name text not null,
  prompt text,                        -- a instrução dada à IA, para regerar depois
  items jsonb not null default '[]'::jsonb,
  sent_at timestamptz,                -- marcado quando o rascunho vira envio
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create index if not exists idx_drafts_team on public.message_drafts(team_id, updated_at desc);

-- ============================================
-- updated_at
-- ============================================
-- touch_updated_at() já existe desde a migration 008.
drop trigger if exists trg_client_groups_touch on public.client_groups;
create trigger trg_client_groups_touch
before update on public.client_groups
for each row execute function public.touch_updated_at();

drop trigger if exists trg_drafts_touch on public.message_drafts;
create trigger trg_drafts_touch
before update on public.message_drafts
for each row execute function public.touch_updated_at();

-- ============================================
-- RLS
-- ============================================
alter table public.client_groups enable row level security;
alter table public.client_group_members enable row level security;
alter table public.message_drafts enable row level security;

drop policy if exists "team_access" on public.client_groups;
create policy "team_access" on public.client_groups
  for all
  using (team_id in (select team_id from public.team_members where user_id = auth.uid()))
  with check (team_id in (select team_id from public.team_members where user_id = auth.uid()));

-- Sem team_id próprio: o acesso é herdado do grupo. O WITH CHECK também exige
-- que o contato seja do mesmo time do grupo, senão daria para pendurar um
-- contato alheio num grupo próprio e fazer o PDF dele ser anexado.
drop policy if exists "team_access" on public.client_group_members;
create policy "team_access" on public.client_group_members
  for all
  using (
    group_id in (
      select id from public.client_groups
      where team_id in (select team_id from public.team_members where user_id = auth.uid())
    )
  )
  with check (
    group_id in (
      select id from public.client_groups
      where team_id in (select team_id from public.team_members where user_id = auth.uid())
    )
    and contact_id in (
      select c.id from public.contacts c
      join public.client_groups g on g.id = client_group_members.group_id
      where c.team_id = g.team_id
    )
  );

drop policy if exists "team_access" on public.message_drafts;
create policy "team_access" on public.message_drafts
  for all
  using (team_id in (select team_id from public.team_members where user_id = auth.uid()))
  with check (team_id in (select team_id from public.team_members where user_id = auth.uid()));
