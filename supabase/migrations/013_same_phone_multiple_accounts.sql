-- ComunicaPro - Mesmo telefone para mais de uma conta
--
-- A regra original era unique(team_id, phone): um telefone, um contato. Mas a
-- mesma pessoa administra várias contas, e cada conta precisa do seu próprio
-- código de cliente para o PDF encontrar o dono. Com a regra antiga, o segundo
-- cadastro era recusado e o segundo relatório ficava sem destinatário.
--
-- A identidade passa a ser (time, telefone, código). O mesmo telefone pode
-- repetir com códigos diferentes; o que continua barrado é o cadastro
-- realmente duplicado — mesmo telefone E mesmo código.
--
-- NULLS NOT DISTINCT (Postgres 15+) é o que faz dois contatos sem código e com
-- o mesmo telefone ainda conflitarem. Sem isso, o Postgres trataria cada NULL
-- como valor único e deixaria entrar duplicata de verdade.

alter table public.contacts drop constraint if exists contacts_team_id_phone_key;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'contacts_team_phone_code_key'
  ) then
    alter table public.contacts
      add constraint contacts_team_phone_code_key
      unique nulls not distinct (team_id, phone, client_code);
  end if;
end $$;

-- Busca por telefone continua sendo feita o tempo todo (checagem de duplicidade
-- e agrupamento por titular), e o índice antigo saiu junto com a constraint.
create index if not exists idx_contacts_team_phone on public.contacts(team_id, phone);
