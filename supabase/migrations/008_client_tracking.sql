-- ComunicaPro - Acompanhamento de clientes (Etapa 1)
--
-- Duas dimensões do acompanhamento, propositalmente separadas:
--   1. fp_cycles       -> histórico de Financial Planning (um registro por ciclo de FP)
--   2. client_products -> o que o cliente tem contratado hoje (uma linha por cliente)
--
-- PRIVACIDADE: nenhuma coluna aqui guarda CPF, RG, conta bancária ou qualquer
-- documento. O identificador do cliente continua sendo contacts.client_code
-- (código da conta). Ver src/lib/privacy.js — o app bloqueia CPF na entrada,
-- tanto no import de CSV quanto nos campos de texto livre desta tela.

-- ============================================
-- CICLOS DE FINANCIAL PLANNING
-- ============================================
-- Um cliente tem vários FPs ao longo do tempo. A visão consolidada mostra
-- sempre o ciclo mais recente; os anteriores ficam como histórico.
--
-- As três colunas pedidas na planilha saem daqui:
--   "Reunião de FP agendada"     -> meeting_scheduled_at
--   "Financial planning realizado" -> completed_at
--   "Financial planning em execução" -> in_execution
-- Elas não são exclusivas entre si de propósito: um FP realizado em agosto
-- pode estar em execução agora e já ter a próxima reunião marcada.
create table if not exists public.fp_cycles (
  id uuid primary key default uuid_generate_v4(),
  team_id uuid not null references public.teams(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,

  meeting_scheduled_at date,   -- quando a reunião de FP está/esteve marcada
  completed_at date,           -- quando o FP foi efetivamente realizado
  in_execution boolean not null default false,
  next_fp_date date,           -- próximo FP, definido no cadastro DESTE ciclo

  -- Principais combinados a monitorar neste FP.
  -- Formato: [{ "texto": "Aumentar aporte para 5k", "feito": false }]
  combinados jsonb not null default '[]'::jsonb,

  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create index if not exists idx_fp_cycles_team on public.fp_cycles(team_id);
create index if not exists idx_fp_cycles_contact on public.fp_cycles(contact_id, created_at desc);
-- Suporta a pergunta "quais FPs vencem nos próximos 30 dias?"
create index if not exists idx_fp_cycles_next on public.fp_cycles(team_id, next_fp_date);

-- ============================================
-- PRODUTOS CONTRATADOS
-- ============================================
-- Uma linha por cliente (o unique em contact_id permite upsert direto).
create table if not exists public.client_products (
  id uuid primary key default uuid_generate_v4(),
  team_id uuid not null references public.teams(id) on delete cascade,
  contact_id uuid not null unique references public.contacts(id) on delete cascade,

  mb boolean not null default false,
  seguro_vida_intl boolean not null default false,
  seguro_vida_nacional boolean not null default false,
  seguradora_vida text,                -- qual seguradora (vida nacional)
  conta_xp boolean not null default false,
  conta_outra_corretora boolean not null default false,
  outra_corretora text,                -- qual corretora, além da XP
  consorcio boolean not null default false,
  consorciadora text,                  -- qual consorciadora
  eqseed boolean not null default false,
  az_guidance boolean not null default false,
  cambio boolean not null default false,
  plano_saude boolean not null default false,
  operadora_saude text,                -- qual operadora

  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

create index if not exists idx_client_products_team on public.client_products(team_id);

-- ============================================
-- updated_at automático
-- ============================================
create or replace function public.touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql set search_path = public;

drop trigger if exists trg_fp_cycles_touch on public.fp_cycles;
create trigger trg_fp_cycles_touch
before update on public.fp_cycles
for each row execute function public.touch_updated_at();

drop trigger if exists trg_client_products_touch on public.client_products;
create trigger trg_client_products_touch
before update on public.client_products
for each row execute function public.touch_updated_at();

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
-- Mesmo padrão das demais tabelas: só membros do time enxergam e escrevem.
-- O WITH CHECK explícito impede que alguém insira/mova uma linha para um
-- team_id que não é o seu (o USING sozinho não cobre isso em insert/update).
alter table public.fp_cycles enable row level security;
alter table public.client_products enable row level security;

drop policy if exists "team_access" on public.fp_cycles;
create policy "team_access" on public.fp_cycles
  for all
  using (
    team_id in (select team_id from public.team_members where user_id = auth.uid())
  )
  with check (
    team_id in (select team_id from public.team_members where user_id = auth.uid())
    -- o contato precisa ser do mesmo time da linha
    and contact_id in (select id from public.contacts where team_id = fp_cycles.team_id)
  );

drop policy if exists "team_access" on public.client_products;
create policy "team_access" on public.client_products
  for all
  using (
    team_id in (select team_id from public.team_members where user_id = auth.uid())
  )
  with check (
    team_id in (select team_id from public.team_members where user_id = auth.uid())
    and contact_id in (select id from public.contacts where team_id = client_products.team_id)
  );
