-- ComunicaPro - Produtos criados pelo próprio time
--
-- O catálogo fixo vive em src/lib/tracking.js (PRODUCTS). Quando entra um
-- produto novo na esteira, o assessor não deveria depender de deploy: ele cria
-- a coluna na tela de Acompanhamento e ela passa a valer para o time todo.
--
-- Não há coluna nova em client_product_status: desde a 014 o estágio fica numa
-- linha por (cliente, produto), com `produto` em texto livre. Esta tabela só
-- diz QUAIS produtos além do catálogo fixo aparecem como coluna.
--
-- Excluir um produto daqui esconde a coluna, mas não apaga os estágios já
-- registrados: recriar com o mesmo nome traz o histórico de volta.

create table if not exists public.produtos_personalizados (
  id uuid primary key default uuid_generate_v4(),
  team_id uuid not null references public.teams(id) on delete cascade,

  chave text not null,              -- valor gravado em client_product_status.produto
  nome text not null,               -- "Zentis", "Previdência VGBL"...
  abreviacao text,                  -- título curto da coluna; vazio = nome
  pergunta_detalhe text,            -- ex.: "Qual seguradora?"; vazio = sem complemento
  ordem int not null default 0,

  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),

  unique (team_id, chave)
);

create index if not exists idx_produtos_personalizados_team
  on public.produtos_personalizados(team_id, ordem);

alter table public.produtos_personalizados enable row level security;

drop policy if exists "team_access" on public.produtos_personalizados;
create policy "team_access" on public.produtos_personalizados
  for all
  using (team_id in (select team_id from public.team_members where user_id = auth.uid()))
  with check (team_id in (select team_id from public.team_members where user_id = auth.uid()));
