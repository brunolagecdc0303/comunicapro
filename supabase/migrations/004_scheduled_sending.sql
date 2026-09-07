-- ComunicaPro - Envios Programados (Etapa 1)
-- Processamento automático da fila, prevenção de envio duplicado,
-- recuperação de mensagens travadas e conclusão automática de campanhas.

-- ============================================
-- Extensão para chamadas HTTP a partir do Postgres (usada pelo pg_cron)
-- ============================================
create extension if not exists pg_net with schema extensions;

-- ============================================
-- message_queue: novo status "cancelled" + marca de início do envio
-- ============================================
alter table public.message_queue
  drop constraint if exists message_queue_status_check;
alter table public.message_queue
  add constraint message_queue_status_check
  check (status in ('pending', 'sending', 'sent', 'failed', 'cancelled'));

alter table public.message_queue
  add column if not exists sending_started_at timestamptz;

create index if not exists idx_queue_stuck
  on public.message_queue (sending_started_at)
  where status = 'sending';

-- ============================================
-- campaigns: novo status "cancelled"
-- ============================================
alter table public.campaigns
  drop constraint if exists campaigns_status_check;
alter table public.campaigns
  add constraint campaigns_status_check
  check (status in ('draft', 'scheduled', 'running', 'completed', 'paused', 'cancelled', 'failed'));

-- ============================================
-- Reserva atômica de mensagens pendentes (evita envio duplicado)
-- Duas execuções simultâneas do processamento nunca pegam a mesma mensagem
-- graças ao "for update skip locked".
-- Uso interno do processamento (send-messages); não deve ser chamável pelo frontend.
-- ============================================
create or replace function public.claim_pending_messages(p_limit int default 50)
returns setof public.message_queue
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.message_queue q
  set status = 'sending', sending_started_at = now()
  from (
    select id
    from public.message_queue
    where status = 'pending' and scheduled_at <= now()
    order by scheduled_at
    limit p_limit
    for update skip locked
  ) claimed
  where q.id = claimed.id
  returning q.*;
end;
$$;

revoke execute on function public.claim_pending_messages(int) from public, authenticated, anon;
grant execute on function public.claim_pending_messages(int) to service_role;

-- ============================================
-- Recupera mensagens travadas em "sending" (ex.: função interrompida no meio do envio)
-- Uso interno do processamento; não deve ser chamável pelo frontend.
-- ============================================
create or replace function public.recover_stuck_messages(p_minutes int default 10)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  update public.message_queue
  set status = 'pending', sending_started_at = null
  where status = 'sending'
    and sending_started_at < now() - (p_minutes || ' minutes')::interval;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.recover_stuck_messages(int) from public, authenticated, anon;
grant execute on function public.recover_stuck_messages(int) to service_role;

-- ============================================
-- Marca campanhas como concluídas quando não sobra nada pendente/enviando na fila
-- Uso interno do processamento; não deve ser chamável pelo frontend.
-- ============================================
create or replace function public.check_completed_campaigns(p_team_id uuid default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  update public.campaigns c
  set status = 'completed', completed_at = now()
  where c.status in ('running', 'scheduled')
    and (p_team_id is null or c.team_id = p_team_id)
    and exists (select 1 from public.message_queue q where q.campaign_id = c.id)
    and not exists (
      select 1 from public.message_queue q
      where q.campaign_id = c.id and q.status in ('pending', 'sending')
    );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.check_completed_campaigns(uuid) from public, authenticated, anon;
grant execute on function public.check_completed_campaigns(uuid) to service_role;

-- ============================================
-- Cancelar um envio programado (chamado pelo frontend)
-- Cancela apenas as mensagens ainda pendentes; o que já foi enviado permanece enviado.
-- Verifica explicitamente que quem chamou pertence ao time da campanha
-- (função é security definer, então essa checagem substitui a RLS aqui dentro).
-- ============================================
create or replace function public.cancel_campaign(p_campaign_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.campaigns c
    join public.team_members tm on tm.team_id = c.team_id
    where c.id = p_campaign_id and tm.user_id = auth.uid()
  ) then
    raise exception 'not authorized';
  end if;

  update public.message_queue
  set status = 'cancelled'
  where campaign_id = p_campaign_id and status = 'pending';

  update public.campaigns
  set status = 'cancelled'
  where id = p_campaign_id and status in ('draft', 'scheduled', 'running');
end;
$$;

grant execute on function public.cancel_campaign(uuid) to authenticated;

-- ============================================
-- Cron: processar a fila a cada minuto
-- ============================================
-- IMPORTANTE — antes deste job funcionar, cadastre os segredos no Vault
-- (SQL Editor do Supabase, execute uma vez, com os valores reais do projeto;
-- NÃO coloque esses valores em nenhum arquivo versionado no git):
--
--   select vault.create_secret('https://SEU_PROJETO.supabase.co', 'comunicapro_project_url');
--   select vault.create_secret('SUA_SERVICE_ROLE_KEY', 'comunicapro_service_role_key');
--
-- Para atualizar um segredo depois: select vault.update_secret(id, novo_valor)
-- (o id de cada segredo aparece em: select * from vault.secrets;)

do $$
begin
  if exists (select 1 from cron.job where jobname = 'process-message-queue') then
    perform cron.unschedule('process-message-queue');
  end if;
end $$;

select cron.schedule(
  'process-message-queue',
  '* * * * *',
  $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'comunicapro_project_url') || '/functions/v1/send-messages',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'comunicapro_service_role_key')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $cron$
);
