-- ComunicaPro - Retry, autorização e correção de RLS (Etapa 3)

-- ============================================
-- Política de retry: nem todo erro é definitivo
-- ============================================
alter table public.message_queue add column if not exists attempts int not null default 0;
alter table public.message_queue add column if not exists last_attempt_at timestamptz;
alter table public.message_queue add column if not exists last_error text;

-- ============================================
-- Corrige falha de escalonamento de privilégio em team_members
--
-- A policy antiga ("team_access", for all) usa a mesma condição pra
-- select/insert/update/delete: pertencer ao team_id da linha. Isso significa
-- que, na prática, QUALQUER membro (inclusive role 'member') podia:
--   - inserir novos membros no time, com qualquer role (inclusive 'owner')
--   - alterar a própria linha e se autopromover a 'owner'
-- porque o WITH CHECK de insert/update só validava "team_id in (meus times)",
-- nunca o role de quem estava fazendo a operação.
--
-- Agora: qualquer membro do time pode VER os outros membros; só quem já é
-- owner/admin pode adicionar, promover/rebaixar ou remover outros membros;
-- ninguém altera o próprio role; e qualquer um pode sair do time sozinho.
-- ============================================
drop policy if exists "team_access" on public.team_members;

create policy "team_members_select" on public.team_members
  for select using (
    team_id in (select team_id from public.team_members where user_id = auth.uid())
  );

create policy "team_members_insert" on public.team_members
  for insert with check (
    team_id in (
      select team_id from public.team_members
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

create policy "team_members_update" on public.team_members
  for update using (
    user_id <> auth.uid()
    and team_id in (
      select team_id from public.team_members
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

create policy "team_members_delete" on public.team_members
  for delete using (
    user_id = auth.uid()
    or team_id in (
      select team_id from public.team_members
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );
