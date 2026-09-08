-- ComunicaPro - Lembretes automáticos de FP (Etapa 2 do acompanhamento)
--
-- Liga a "data do próximo FP" ao módulo de envio que já existe: quando a data
-- se aproxima, o lembrete entra na message_queue como qualquer outra mensagem
-- e o cron de envio (process-message-queue, de minuto em minuto) cuida do
-- resto — delay entre mensagens, retry, log. Nada de máquina de envio nova.
--
-- Segurança: o disparo nasce DESLIGADO. Só passa a valer depois que o time
-- ligar em Configurações, definir o texto e o telefone do assessor. Enquanto
-- fp_reminder_enabled for false, esta função não enfileira nada.

-- ============================================
-- Controle de duplicidade
-- ============================================
-- Um ciclo de FP gera no máximo um lembrete. reminder_sent_at é o que impede
-- o cron de reenviar a mesma coisa todo dia até a data chegar.
alter table public.fp_cycles add column if not exists reminder_sent_at timestamptz;
alter table public.fp_cycles add column if not exists reminder_campaign_id uuid references public.campaigns(id) on delete set null;

-- Índice do scan diário: só interessam ciclos com data futura e sem lembrete.
create index if not exists idx_fp_cycles_reminder_pending
  on public.fp_cycles (team_id, next_fp_date)
  where reminder_sent_at is null and next_fp_date is not null;

-- ============================================
-- Enfileira os lembretes de FP que vencem na janela configurada
-- ============================================
-- Roda como security definer porque é chamada pelo cron (sem auth.uid()).
-- Não é chamável pelo frontend: o EXECUTE fica só com o service_role.
--
-- p_dry_run = true apenas devolve o que SERIA enviado, sem gravar nada —
-- é o que alimenta a pré-visualização na tela de Configurações.
create or replace function public.enqueue_fp_reminders(
  p_team_id uuid default null,
  p_dry_run boolean default false
)
returns table (
  team_id uuid,
  contact_name text,
  phone text,
  next_fp_date date,
  content text,
  recipient text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team record;
  v_cycle record;
  v_campaign_id uuid;
  v_days int;
  v_template text;
  v_advisor_phone text;
  v_content text;
  v_digest text;
  v_count int;
begin
  for v_team in
    select t.id, t.name, t.settings
    from public.teams t
    where (p_team_id is null or t.id = p_team_id)
      and coalesce((t.settings->>'fp_reminder_enabled')::boolean, false) = true
  loop
    v_days := coalesce((v_team.settings->>'fp_reminder_days_before')::int, 7);
    v_template := coalesce(
      nullif(v_team.settings->>'fp_reminder_template', ''),
      'Oi {{nome}}! Passando para lembrar que seu Financial Planning está previsto para {{data}}. Podemos agendar nossa conversa?'
    );
    v_advisor_phone := nullif(v_team.settings->>'fp_reminder_advisor_phone', '');

    v_campaign_id := null;
    v_digest := '';
    v_count := 0;

    for v_cycle in
      select f.id, f.next_fp_date, f.combinados, c.id as contact_id, c.name, c.phone
      from public.fp_cycles f
      join public.contacts c on c.id = f.contact_id
      where f.team_id = v_team.id
        and f.reminder_sent_at is null
        and f.next_fp_date is not null
        and f.next_fp_date between current_date and current_date + v_days
        and coalesce(c.phone, '') <> ''
      order by f.next_fp_date, c.name
    loop
      v_content := replace(
                     replace(v_template, '{{nome}}', v_cycle.name),
                     '{{data}}', to_char(v_cycle.next_fp_date, 'DD/MM/YYYY')
                   );

      -- Linha de retorno: no dry run é só isso que acontece.
      team_id := v_team.id;
      contact_name := v_cycle.name;
      phone := v_cycle.phone;
      next_fp_date := v_cycle.next_fp_date;
      content := v_content;
      recipient := 'cliente';
      return next;

      v_count := v_count + 1;
      v_digest := v_digest || format(E'\n• %s — %s', v_cycle.name, to_char(v_cycle.next_fp_date, 'DD/MM'));

      if not p_dry_run then
        -- Uma campanha por execução/time, criada só quando há o que enviar.
        if v_campaign_id is null then
          insert into public.campaigns (team_id, name, status, started_at, delay_seconds)
          values (v_team.id,
                  'Lembretes de FP · ' || to_char(current_date, 'DD/MM/YYYY'),
                  'running', now(),
                  coalesce((v_team.settings->>'delay_between_messages')::int, 5))
          returning id into v_campaign_id;
        end if;

        insert into public.message_queue (campaign_id, contact_id, phone, content, status, scheduled_at)
        values (v_campaign_id, v_cycle.contact_id, v_cycle.phone, v_content, 'pending', now());

        update public.fp_cycles
        set reminder_sent_at = now(), reminder_campaign_id = v_campaign_id
        where id = v_cycle.id;
      end if;
    end loop;

    -- Cópia para o assessor: um resumo por execução, não uma mensagem por cliente.
    if v_count > 0 and v_advisor_phone is not null then
      v_content := format('Lembretes de FP enviados hoje (%s cliente(s)):%s', v_count, v_digest);

      team_id := v_team.id;
      contact_name := 'Assessor';
      phone := v_advisor_phone;
      next_fp_date := null;
      content := v_content;
      recipient := 'assessor';
      return next;

      if not p_dry_run then
        insert into public.message_queue (campaign_id, contact_id, phone, content, status, scheduled_at)
        values (v_campaign_id, null, v_advisor_phone, v_content, 'pending', now());

        update public.campaigns
        set total_recipients = v_count + 1
        where id = v_campaign_id;
      end if;
    end if;
  end loop;
end;
$$;

revoke execute on function public.enqueue_fp_reminders(uuid, boolean) from public, anon, authenticated;
grant execute on function public.enqueue_fp_reminders(uuid, boolean) to service_role;

-- ============================================
-- Pré-visualização para o frontend
-- ============================================
-- Wrapper seguro: sempre dry run, sempre restrito ao time de quem chamou.
-- É o que a tela de Configurações usa para mostrar "o que sairia hoje".
create or replace function public.preview_fp_reminders(p_team_id uuid)
returns table (
  contact_name text,
  phone text,
  next_fp_date date,
  content text,
  recipient text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.team_members
    where team_id = p_team_id and user_id = auth.uid()
  ) then
    raise exception 'not authorized';
  end if;

  return query
    select r.contact_name, r.phone, r.next_fp_date, r.content, r.recipient
    from public.enqueue_fp_reminders(p_team_id, true) r;
end;
$$;

revoke execute on function public.preview_fp_reminders(uuid) from public, anon;
grant execute on function public.preview_fp_reminders(uuid) to authenticated;

-- ============================================
-- Cron: uma vez por dia, às 12:00 UTC (09:00 em Brasília)
-- ============================================
-- Horário comercial de propósito: o lembrete entra na fila e sai em seguida,
-- então não pode cair de madrugada no WhatsApp do cliente.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'fp-reminders') then
    perform cron.unschedule('fp-reminders');
  end if;
end $$;

select cron.schedule(
  'fp-reminders',
  '0 12 * * *',
  $cron$ select public.enqueue_fp_reminders(null, false) $cron$
);
