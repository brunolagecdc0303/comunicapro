-- ComunicaPro - Produtos viram ESTÁGIO, não sim/não
--
-- A planilha que a assessoria usa hoje não registra "o cliente tem ou não tem
-- o produto". Registra em que ponto da conversa aquele produto está: Oferecer,
-- Em contato, Tem interesse, FECHOU!, Não quer, NEGADO, Vácuo... Isso é uma
-- esteira de cross sell, e é bem mais útil do que um booleano: "não tem" não
-- distingue quem nunca foi abordado de quem disse não.
--
-- client_products (uma coluna booleana por produto) some. No lugar entra uma
-- linha por (cliente, produto), o que também evita uma migration nova cada vez
-- que um produto entra no catálogo.

-- A tabela antiga só tinha 2 linhas, ambas totalmente vazias — nada a preservar.
drop table if exists public.client_products;

create table if not exists public.client_product_status (
  id uuid primary key default uuid_generate_v4(),
  team_id uuid not null references public.teams(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,

  produto text not null,
  status text not null default 'oferecer' check (status in (
    'oferecer',        -- ainda não abordado
    'em_contato',      -- conversa em andamento
    'tem_interesse',
    'ja_conversamos',
    'ja_possui',       -- já tem, contratado fora
    'fechou',          -- fechou comigo
    'nao_quer',
    'negado',          -- recusado pela contraparte (ex.: subscrição do seguro)
    'agora_nao',       -- "no momento, não" — reabordar depois
    'vacuo',           -- sem resposta
    'na'               -- não se aplica a este cliente
  )),

  -- Seguradora, consorciadora, taxa do fee fixo: o complemento varia por produto.
  detalhe text,
  observacao text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),

  unique (contact_id, produto)
);

create index if not exists idx_cps_team on public.client_product_status(team_id);
create index if not exists idx_cps_produto on public.client_product_status(team_id, produto, status);

-- ============================================
-- PERFIL DE RELACIONAMENTO
-- ============================================
-- As colunas da planilha que falam da relação, não de um produto específico.
create table if not exists public.client_profile (
  id uuid primary key default uuid_generate_v4(),
  team_id uuid not null references public.teams(id) on delete cascade,
  contact_id uuid not null unique references public.contacts(id) on delete cascade,

  proximidade text check (proximidade in ('bem_proximo', 'mediano', 'pouco_contato', 'na')),

  indicacao text check (indicacao in ('forneceu', 'ja_pedi', 'disse_que_indica', 'pedir', 'na')),
  num_indicacoes int,
  indicacao_obs text,

  -- "FeedBack Carteira (último feito)": na planilha é uma data ou um lembrete
  -- ("FAZER"). Aqui a data é data; o lembrete vira ausência de data.
  feedback_carteira date,

  -- "24k (gasto 4k)" — reserva e gasto mensal juntos, como o assessor anota.
  liquidez text,

  obs_cross_sell text,
  observacoes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

create index if not exists idx_profile_team on public.client_profile(team_id);

-- ============================================
-- updated_at + RLS
-- ============================================
drop trigger if exists trg_cps_touch on public.client_product_status;
create trigger trg_cps_touch before update on public.client_product_status
for each row execute function public.touch_updated_at();

drop trigger if exists trg_profile_touch on public.client_profile;
create trigger trg_profile_touch before update on public.client_profile
for each row execute function public.touch_updated_at();

alter table public.client_product_status enable row level security;
alter table public.client_profile enable row level security;

drop policy if exists "team_access" on public.client_product_status;
create policy "team_access" on public.client_product_status
  for all
  using (team_id in (select team_id from public.team_members where user_id = auth.uid()))
  with check (
    team_id in (select team_id from public.team_members where user_id = auth.uid())
    and contact_id in (select id from public.contacts where team_id = client_product_status.team_id)
  );

drop policy if exists "team_access" on public.client_profile;
create policy "team_access" on public.client_profile
  for all
  using (team_id in (select team_id from public.team_members where user_id = auth.uid()))
  with check (
    team_id in (select team_id from public.team_members where user_id = auth.uid())
    and contact_id in (select id from public.contacts where team_id = client_profile.team_id)
  );
