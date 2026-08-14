-- Migração: trocar Gemini por Claude (Anthropic)
-- Adiciona coluna claude_api_key na tabela teams

ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS claude_api_key text;

-- Migrar dados existentes do Gemini para Claude (caso alguém já tivesse configurado)
-- UPDATE public.teams SET claude_api_key = gemini_api_key WHERE gemini_api_key IS NOT NULL;

-- Opcional: remover coluna antiga depois de confirmar que tudo funciona
-- ALTER TABLE public.teams DROP COLUMN IF EXISTS gemini_api_key;
