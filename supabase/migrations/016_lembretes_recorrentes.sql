-- ComunicaPro - Lembretes recorrentes a partir do Financial Planning
--
-- O FP produz combinados que não são um evento único: "aportar todo dia 15",
-- "revisar a previdência todo mês". A 009 já liga a DATA do próximo FP a uma
-- mensagem, mas é um disparo só, guardado por reminder_sent_at. Aqui o que se
-- cadastra é a REGRA — dia 15 de todo mês — e ela continua valendo até o
-- assessor desligar ou até a data de término.
--
-- Nada de motor de envio novo: o lembrete entra na message_queue como qualquer
-- outra mensagem e o process-message-queue (de minuto em minuto) cuida de
-- delay, retry e log.
--
-- Diferença de postura em relação à 009: lá o gatilho nascia desligado porque
-- varria TODOS os ciclos e podia disparar dezenas de mensagens no dia em que a
-- migration subisse, com dados digitados para outro fim. Aqui a tabela nasce
-- vazia — só existe lembrete que o assessor criou, para um cliente nomeado,
-- com o texto que ele mesmo escreveu. O "ativo" de cada lembrete é o opt-in.
-- O que existe por cima é um freio de mão por time
-- (settings->>'lembretes_recorrentes_pausados'), para parar tudo de uma vez
-- sem ter que apagar nada.

-- ============================================
-- A REGRA
-- ============================================
create table if not exists public.fp_lembretes (
  id uuid primary key default uuid_generate_v4(),
  team_id uuid not null references public.teams(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,

  -- De qual ciclo de FP este lembrete nasceu. on delete set null: apagar o
  -- ciclo não pode desligar silenciosamente uma mensagem que já está no ar.
  fp_cycle_id uuid references public.fp_cycles(id) on delete set null,

  titulo text not null,
  template text not null,

  frequencia text not null default 'mensal' check (frequencia in ('mensal', 'semanal')),
  dia_do_mes int check (dia_do_mes between 1 and 31),
  dia_da_semana int check (dia_da_semana between 0 and 6),  -- 0 = domingo

  -- Hora local de Brasília. O cron roda às 06:00 BRT e agenda a mensagem para
  -- este horário no mesmo dia.
  hora time not null default '09:00',

  inicio date not null default current_date,
  fim date,

  ativo boolean not null default true,
  copia_assessor boolean not null default false,

  -- Duas marcas diferentes de propósito: ultimo_envio_em é quando a mensagem
  -- de fato entrou na fila (para a tela); ultima_ocorrencia é QUAL data da
  -- regra já foi tratada — é ela que impede o reenvio. Guardar só o relógio
  -- não serve: comparar "agora" com a data da ocorrência dá falso negativo.
  ultimo_envio_em timestamptz,
  ultima_ocorrencia date,
  total_enviado int not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),

  -- Cada frequência exige o seu campo: sem isso um lembrete "mensal" sem dia
  -- ficaria cadastrado e nunca dispararia, sem ninguém perceber.
  constraint fp_lembretes_regra_completa check (
    (frequencia = 'mensal'  and dia_do_mes   is not null) or
    (frequencia = 'semanal' and dia_da_semana is not null)
  ),
  constraint fp_lembretes_periodo check (fim is null or fim >= inicio)
);

create index if not exists idx_fp_lembretes_team on public.fp_lembretes(team_id);
create index if not exists idx_fp_lembretes_contato on public.fp_lembretes(contact_id);
-- Índice da varredura diária: só interessam os ligados.
create index if not exists idx_fp_lembretes_ativos
  on public.fp_lembretes(team_id, frequencia) where ativo;

drop trigger if exists trg_fp_lembretes_touch on public.fp_lembretes;
create trigger trg_fp_lembretes_touch before update on public.fp_lembretes
for each row execute function public.touch_updated_at();

alter table public.fp_lembretes enable row level security;

drop policy if exists "team_access" on public.fp_lembretes;
create policy "team_access" on public.fp_lembretes
  for all
  using (team_id in (select team_id from public.team_members where user_id = auth.uid()))
  with check (
    team_id in (select team_id from public.team_members where user_id = auth.uid())
    and contact_id in (select id from public.contacts where team_id = fp_lembretes.team_id)
  );

-- ============================================
-- A regra bate com a data?
-- ============================================
-- O caso que quebra a versão ingênua: "todo dia 31". Fevereiro não tem 31, e
-- um `extract(day) = 31` simplesmente pularia o mês — o assessor acharia que
-- cadastrou e nunca receberia nada. Dia maior que o mês cai no último dia.
create or replace function public.fp_lembrete_vence_em(
  p_frequencia text,
  p_dia_do_mes int,
  p_dia_da_semana int,
  p_data date
)
returns boolean
language sql
immutable
as $$
  select case p_frequencia
    when 'semanal' then extract(dow from p_data)::int = p_dia_da_semana
    when 'mensal' then extract(day from p_data)::int = least(
      p_dia_do_mes,
      extract(day from (date_trunc('month', p_data) + interval '1 month - 1 day'))::int
    )
    else false
  end;
$$;

-- ============================================
-- Qual ocorrência está devida hoje
-- ============================================
-- Não é "a regra bate com hoje?". Se o cron não rodar no dia 15 — a Supabase
-- pisca, o job falha — a versão ingênua simplesmente pula o mês inteiro e
-- ninguém fica sabendo. Aqui olhamos alguns dias para trás e devolvemos a
-- ocorrência mais recente ainda não tratada, para o lembrete sair atrasado
-- em vez de não sair. A tolerância é curta de propósito: um lembrete religado
-- depois de meses não deve cuspir o combinado de março.
create or replace function public.fp_lembrete_ocorrencia_devida(
  p_frequencia text,
  p_dia_do_mes int,
  p_dia_da_semana int,
  p_data date,
  p_tolerancia_dias int default 3
)
returns date
language plpgsql
immutable
as $$
declare
  v_data date := p_data;
begin
  while v_data >= p_data - p_tolerancia_dias loop
    if public.fp_lembrete_vence_em(p_frequencia, p_dia_do_mes, p_dia_da_semana, v_data) then
      return v_data;
    end if;
    v_data := v_data - 1;
  end loop;
  return null;
end;
$$;

-- ============================================
-- Próxima data de disparo (para mostrar na tela)
-- ============================================
create or replace function public.fp_lembrete_proximo(
  p_frequencia text,
  p_dia_do_mes int,
  p_dia_da_semana int,
  p_inicio date,
  p_fim date,
  p_a_partir_de date default current_date
)
returns date
language plpgsql
immutable
as $$
declare
  v_data date := greatest(p_a_partir_de, p_inicio);
  v_limite date := coalesce(p_fim, v_data + 400);
begin
  -- 400 dias cobre qualquer regra mensal ou semanal; se nada bate até lá, a
  -- regra é impossível e devolver null é mais honesto que devolver uma data.
  while v_data <= v_limite loop
    if public.fp_lembrete_vence_em(p_frequencia, p_dia_do_mes, p_dia_da_semana, v_data) then
      return v_data;
    end if;
    v_data := v_data + 1;
  end loop;
  return null;
end;
$$;

-- ============================================
-- Enfileira os lembretes recorrentes que vencem hoje
-- ============================================
-- Mesmo contrato da enqueue_fp_reminders: security definer (o cron não tem
-- auth.uid()), execute só para o service_role, e p_dry_run devolve o que
-- SERIA enviado sem gravar nada.
create or replace function public.enqueue_fp_lembretes(
  p_team_id uuid default null,
  p_dry_run boolean default false,
  p_data date default current_date
)
returns table (
  team_id uuid,
  lembrete_id uuid,
  titulo text,
  contact_name text,
  phone text,
  enviar_as timestamptz,
  content text,
  recipient text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team record;
  v_lembrete record;
  v_campaign_id uuid;
  v_advisor_phone text;
  v_content text;
  v_quando timestamptz;
  v_digest text;
  v_count int;
begin
  for v_team in
    select t.id, t.settings
    from public.teams t
    where (p_team_id is null or t.id = p_team_id)
      -- Freio de mão: pausado = ninguém dispara, por mais lembrete ativo que exista.
      and coalesce((t.settings->>'lembretes_recorrentes_pausados')::boolean, false) = false
  loop
    v_advisor_phone := nullif(v_team.settings->>'fp_reminder_advisor_phone', '');

    v_campaign_id := null;
    v_digest := '';
    v_count := 0;

    for v_lembrete in
      select l.id, l.titulo, l.template, l.hora, l.copia_assessor,
             c.id as contact_id, c.name, c.phone,
             public.fp_lembrete_ocorrencia_devida(
               l.frequencia, l.dia_do_mes, l.dia_da_semana, p_data) as ocorrencia
      from public.fp_lembretes l
      join public.contacts c on c.id = l.contact_id
      where l.team_id = v_team.id
        and l.ativo
        and coalesce(c.phone, '') <> ''
        and public.fp_lembrete_ocorrencia_devida(
              l.frequencia, l.dia_do_mes, l.dia_da_semana, p_data) is not null
        -- Idempotência: uma ocorrência é tratada uma vez só, por mais vezes
        -- que o cron rode. O período vale contra a ocorrência, não contra hoje.
        and l.inicio <= public.fp_lembrete_ocorrencia_devida(
              l.frequencia, l.dia_do_mes, l.dia_da_semana, p_data)
        and (l.fim is null or l.fim >= public.fp_lembrete_ocorrencia_devida(
              l.frequencia, l.dia_do_mes, l.dia_da_semana, p_data))
        and coalesce(l.ultima_ocorrencia, date '1900-01-01') < public.fp_lembrete_ocorrencia_devida(
              l.frequencia, l.dia_do_mes, l.dia_da_semana, p_data)
      order by c.name, l.titulo
    loop
      v_content := replace(
                     replace(
                       replace(v_lembrete.template, '{{nome}}', v_lembrete.name),
                       '{{data}}', to_char(v_lembrete.ocorrencia, 'DD/MM/YYYY')),
                     '{{titulo}}', v_lembrete.titulo
                   );

      -- Hora escolhida pelo assessor, em Brasília. Se o cron atrasar e a hora
      -- já tiver passado, sai agora em vez de ficar para o dia seguinte.
      v_quando := greatest(
        ((v_lembrete.ocorrencia + v_lembrete.hora) at time zone 'America/Sao_Paulo'),
        now()
      );

      team_id := v_team.id;
      lembrete_id := v_lembrete.id;
      titulo := v_lembrete.titulo;
      contact_name := v_lembrete.name;
      phone := v_lembrete.phone;
      enviar_as := v_quando;
      content := v_content;
      recipient := 'cliente';
      return next;

      v_count := v_count + 1;
      if v_lembrete.copia_assessor then
        v_digest := v_digest || format(E'\n• %s — %s', v_lembrete.name, v_lembrete.titulo);
      end if;

      if not p_dry_run then
        -- Uma campanha por execução/time, criada só quando há o que enviar.
        if v_campaign_id is null then
          insert into public.campaigns (team_id, name, status, started_at, delay_seconds)
          values (v_team.id,
                  'Lembretes recorrentes · ' || to_char(p_data, 'DD/MM/YYYY'),
                  'running', now(),
                  coalesce((v_team.settings->>'delay_between_messages')::int, 5))
          returning id into v_campaign_id;
        end if;

        insert into public.message_queue (campaign_id, contact_id, phone, content, status, scheduled_at)
        values (v_campaign_id, v_lembrete.contact_id, v_lembrete.phone, v_content, 'pending', v_quando);

        update public.fp_lembretes
        set ultimo_envio_em = now(),
            ultima_ocorrencia = v_lembrete.ocorrencia,
            total_enviado = total_enviado + 1
        where id = v_lembrete.id;
      end if;
    end loop;

    -- Cópia para o assessor: um resumo do dia, não uma mensagem por cliente.
    if v_digest <> '' and v_advisor_phone is not null then
      v_content := format('Lembretes recorrentes de hoje (%s):%s',
                          to_char(p_data, 'DD/MM'), v_digest);

      team_id := v_team.id;
      lembrete_id := null;
      titulo := null;
      contact_name := 'Assessor';
      phone := v_advisor_phone;
      -- O resumo sai de manhã, antes do primeiro lembrete do dia.
      v_quando := greatest(((p_data + time '08:00') at time zone 'America/Sao_Paulo'), now());
      enviar_as := v_quando;
      content := v_content;
      recipient := 'assessor';
      return next;

      if not p_dry_run then
        insert into public.message_queue (campaign_id, contact_id, phone, content, status, scheduled_at)
        values (v_campaign_id, null, v_advisor_phone, v_content, 'pending', v_quando);
        v_count := v_count + 1;
      end if;
    end if;

    if not p_dry_run and v_campaign_id is not null then
      update public.campaigns set total_recipients = v_count where id = v_campaign_id;
    end if;
  end loop;
end;
$$;

revoke execute on function public.enqueue_fp_lembretes(uuid, boolean, date) from public, anon, authenticated;
grant execute on function public.enqueue_fp_lembretes(uuid, boolean, date) to service_role;

-- ============================================
-- Pré-visualização para o frontend
-- ============================================
-- Wrapper seguro: sempre dry run, sempre restrito ao time de quem chamou.
-- p_data permite ver "o que sai no dia 15" sem esperar chegar o dia 15.
create or replace function public.preview_fp_lembretes(
  p_team_id uuid,
  p_data date default current_date
)
returns table (
  lembrete_id uuid,
  titulo text,
  contact_name text,
  phone text,
  enviar_as timestamptz,
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
    select r.lembrete_id, r.titulo, r.contact_name, r.phone, r.enviar_as, r.content, r.recipient
    from public.enqueue_fp_lembretes(p_team_id, true, p_data) r;
end;
$$;

revoke execute on function public.preview_fp_lembretes(uuid, date) from public, anon;
grant execute on function public.preview_fp_lembretes(uuid, date) to authenticated;

-- ============================================
-- Cron: uma vez por dia, às 09:00 UTC (06:00 em Brasília)
-- ============================================
-- Roda cedo de propósito: só ENFILEIRA. A mensagem em si fica com
-- scheduled_at na hora que o assessor escolheu (08:00 em diante na tela),
-- e o process-message-queue a solta na hora certa.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'fp-lembretes-recorrentes') then
    perform cron.unschedule('fp-lembretes-recorrentes');
  end if;
end $$;

select cron.schedule(
  'fp-lembretes-recorrentes',
  '0 9 * * *',
  $cron$ select public.enqueue_fp_lembretes(null, false) $cron$
);

-- ============================================
-- search_path fixo nas funções de data
-- ============================================
-- São puras, mas sem search_path fixo quem chamar com outro search_path pode
-- apontar para outra fp_lembrete_vence_em. Fechar é barato.
alter function public.fp_lembrete_vence_em(text, int, int, date) set search_path = public;
alter function public.fp_lembrete_ocorrencia_devida(text, int, int, date, int) set search_path = public;
alter function public.fp_lembrete_proximo(text, int, int, date, date, date) set search_path = public;
