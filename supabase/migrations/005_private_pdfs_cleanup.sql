-- ComunicaPro - PDFs privados + limpeza automática após 7 dias (Etapa 2)

-- ============================================
-- pdf_library: guarda o caminho no Storage (independe do formato da URL)
-- ============================================
alter table public.pdf_library add column if not exists storage_path text;

-- Backfill: extrai o caminho a partir da antiga URL pública, para PDFs já existentes
update public.pdf_library
set storage_path = substring(file_url from '/pdfs/(.*)$')
where storage_path is null and file_url like '%/pdfs/%';

-- file_url deixa de ser a fonte de verdade (o bucket vai ficar privado);
-- mantido só para compatibilidade com registros antigos.
alter table public.pdf_library alter column file_url drop not null;

create index if not exists idx_pdf_created_at on public.pdf_library(created_at);

-- ============================================
-- Bucket "pdfs" deixa de ser público
-- São documentos de clientes; não devem ficar acessíveis por URL direta e indefinida.
-- ============================================
update storage.buckets set public = false where id = 'pdfs';

-- ============================================
-- RLS do Storage: cada time só acessa os PDFs na sua própria pasta
-- Os arquivos são salvos como "<team_id>/<arquivo>", então o primeiro
-- segmento do caminho identifica o time dono do arquivo.
-- ============================================
alter table storage.objects enable row level security;

drop policy if exists "pdfs_team_select" on storage.objects;
create policy "pdfs_team_select" on storage.objects
  for select using (
    bucket_id = 'pdfs' and
    (storage.foldername(name))[1] in (
      select team_id::text from public.team_members where user_id = auth.uid()
    )
  );

drop policy if exists "pdfs_team_insert" on storage.objects;
create policy "pdfs_team_insert" on storage.objects
  for insert with check (
    bucket_id = 'pdfs' and
    (storage.foldername(name))[1] in (
      select team_id::text from public.team_members where user_id = auth.uid()
    )
  );

drop policy if exists "pdfs_team_delete" on storage.objects;
create policy "pdfs_team_delete" on storage.objects
  for delete using (
    bucket_id = 'pdfs' and
    (storage.foldername(name))[1] in (
      select team_id::text from public.team_members where user_id = auth.uid()
    )
  );

-- ============================================
-- Cron: limpar PDFs com mais de 7 dias, todo dia às 02:00 (UTC)
-- Apaga o arquivo no Storage (bucket "pdfs") e o registro em pdf_library.
-- Usa os mesmos segredos do Vault já cadastrados para o cron de envio
-- (comunicapro_project_url e comunicapro_service_role_key — ver migration 004
-- e o README para instruções de cadastro).
-- ============================================
do $$
begin
  if exists (select 1 from cron.job where jobname = 'cleanup-old-pdfs') then
    perform cron.unschedule('cleanup-old-pdfs');
  end if;
end $$;

select cron.schedule(
  'cleanup-old-pdfs',
  '0 2 * * *',
  $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'comunicapro_project_url') || '/functions/v1/cleanup-pdfs',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'comunicapro_service_role_key')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $cron$
);
