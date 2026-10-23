-- ComunicaPro - Jornada do cliente (Acompanhamento 2.0)
--
-- A jornada segue o método do Bruno:
--   Sem diagnóstico -> Diagnóstico feito -> FP entregue (em implantação) -> Em acompanhamento
-- A etapa é DERIVADA (diagnosticos_360 + fp_cycles), nunca digitada. Atraso também é
-- derivado na tela; nada de status "vencido" gravado.

-- ============================================
-- QUEM ESTÁ NA JORNADA + PRÓXIMO PASSO
-- ============================================
alter table public.client_profile add column if not exists na_jornada boolean not null default false;
alter table public.client_profile add column if not exists tier text check (tier in ('A','B','C','D'));
alter table public.client_profile add column if not exists proximo_passo text;
alter table public.client_profile add column if not exists proximo_passo_data date;
alter table public.client_profile add column if not exists pasta_drive_url text;

create index if not exists idx_profile_jornada on public.client_profile(team_id) where na_jornada;

-- ============================================
-- PDF DO FP
-- ============================================
-- O FP é gerado pela XP; o assessor sobe o PDF no card. O arquivo fica no bucket
-- privado "pdfs" (pasta <team_id>/fp/...) e uma cópia vai para a pasta do cliente no Drive.
alter table public.fp_cycles add column if not exists pdf_path text;
alter table public.fp_cycles add column if not exists pdf_nome text;
alter table public.fp_cycles add column if not exists pdf_drive_url text;

-- ============================================
-- DIAGNÓSTICOS 360
-- ============================================
-- Uma linha por diagnóstico gerado pela automação noturna (transcrição do Meet ->
-- rascunho na pasta do cliente no Drive). A automação grava aqui pelo conector do
-- Supabase; contact_id fica nulo quando o nome não bate com nenhum contato, e a tela
-- oferece o vínculo manual.
create table if not exists public.diagnosticos_360 (
  id uuid primary key default uuid_generate_v4(),
  team_id uuid not null references public.teams(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,

  cliente_nome text not null,
  data_reuniao date not null,
  tipo text,                 -- descoberta, fechamento, revisão 360...
  situacao text,             -- prospect | cliente
  diagnostico_url text,
  briefing_url text,
  pasta_url text,
  transcricao_id text,       -- id do doc do Meet; evita duplicar
  numero_central text,
  meta text,
  distancia text,
  pendencias text,           -- "O que ainda preciso", em texto corrido

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_diag_transcricao
  on public.diagnosticos_360(team_id, transcricao_id) where transcricao_id is not null;
create index if not exists idx_diag_contact on public.diagnosticos_360(contact_id, data_reuniao desc);

drop trigger if exists trg_diag_touch on public.diagnosticos_360;
create trigger trg_diag_touch before update on public.diagnosticos_360
for each row execute function public.touch_updated_at();

alter table public.diagnosticos_360 enable row level security;

drop policy if exists "team_access" on public.diagnosticos_360;
create policy "team_access" on public.diagnosticos_360
  for all
  using (team_id in (select team_id from public.team_members where user_id = auth.uid()))
  with check (
    team_id in (select team_id from public.team_members where user_id = auth.uid())
    and (contact_id is null
         or contact_id in (select id from public.contacts where team_id = diagnosticos_360.team_id))
  );

-- ============================================
-- ÚLTIMO CONTATO
-- ============================================
-- Toda mensagem enviada pelo ComunicaPro conta como contato. A view roda com os
-- privilégios de quem consulta (security_invoker), então o RLS das tabelas vale.
create or replace view public.v_ultimo_contato
with (security_invoker = true) as
select c.id as contact_id,
       c.team_id,
       greatest(max(ml.sent_at), max(mq.sent_at)) as ultimo_envio
from public.contacts c
left join public.message_log ml
  on ml.team_id = c.team_id
 and regexp_replace(ml.contact_phone, '\D', '', 'g') = regexp_replace(c.phone, '\D', '', 'g')
 and ml.status in ('sent', 'enviado', 'delivered')
left join public.message_queue mq
  on mq.contact_id = c.id and mq.status = 'sent'
group by c.id, c.team_id;
