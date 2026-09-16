-- ComunicaPro - Envio pela fila com anexo, e templates de instrução
--
-- 1) message_queue ganha o CAMINHO do documento, não a URL.
--    O bucket de PDFs é privado e o acesso é por URL assinada temporária. Se a
--    URL fosse gerada agora, na hora de enfileirar, ela expiraria antes de a
--    fila chegar na mensagem — um lote grande leva minutos. Guardando o
--    caminho, a Edge Function assina a URL no instante do envio.
--
-- 2) message_templates ganha `kind`, para separar modelo de MENSAGEM (texto
--    pronto, que a tela de Templates já usa) de modelo de INSTRUÇÃO (o prompt
--    dado à IA, que se repete todo mês).

alter table public.message_queue add column if not exists document_path text;
alter table public.message_queue add column if not exists document_name text;

alter table public.message_templates
  add column if not exists kind text not null default 'mensagem';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'message_templates_kind_check'
  ) then
    alter table public.message_templates
      add constraint message_templates_kind_check check (kind in ('mensagem', 'instrucao'));
  end if;
end $$;

create index if not exists idx_templates_kind on public.message_templates(team_id, kind);

-- ============================================
-- Última mensagem enviada para cada telefone
-- ============================================
-- Alimenta o aviso "você já falou com essa pessoa há X dias" na revisão, para
-- não mandar dois disparos seguidos para o mesmo cliente sem perceber.
-- security definer + checagem de membership: a função é chamada pelo frontend.
create or replace function public.ultimo_contato_por_telefone(p_team_id uuid)
returns table (phone text, ultima timestamptz, conteudo text)
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
    select distinct on (l.contact_phone)
           l.contact_phone, l.sent_at, left(l.content, 160)
    from public.message_log l
    where l.team_id = p_team_id
      and l.status = 'sent'
      and l.direction = 'outbound'
      and l.contact_phone is not null
    order by l.contact_phone, l.sent_at desc;
end;
$$;

revoke execute on function public.ultimo_contato_por_telefone(uuid) from public, anon;
grant execute on function public.ultimo_contato_por_telefone(uuid) to authenticated;
