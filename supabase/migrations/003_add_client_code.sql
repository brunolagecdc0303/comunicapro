-- Migração: adicionar codigo_cliente em contacts e pdf_library

-- Contatos: campo para código do cliente (vem do CSV)
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS client_code text;
CREATE INDEX IF NOT EXISTS idx_contacts_client_code ON public.contacts(team_id, client_code);

-- PDFs: campo para código do cliente (extraído do nome do arquivo)
ALTER TABLE public.pdf_library ADD COLUMN IF NOT EXISTS client_code text;
CREATE INDEX IF NOT EXISTS idx_pdf_client_code ON public.pdf_library(team_id, client_code);
