# ComunicaPro

Plataforma de comunicação em massa via WhatsApp para assessores de investimentos.

**Stack:** React + Vite + Tailwind (Netlify) | Supabase (DB, Auth, Edge Functions, Cron)

---

## Funcionalidades

- **Mensagens em massa** via Wasender API com delay anti-bloqueio
- **Envios Programados** — agende campanhas para data/hora específica, acompanhe o status (programado, processando, concluído, erro, cancelado) e cancele antes do horário
- **Processamento automático** da fila via `pg_cron` a cada minuto, com proteção contra envio duplicado (reserva atômica) e recuperação de mensagens travadas
- **PDFs privados com limpeza automática** — bucket não-público, acesso só via URL assinada e temporária; arquivos com mais de 7 dias são apagados todo dia às 02:00
- **Import de contatos** via CSV (aceita variações de colunas)
- **Geração de mensagens com IA** (Claude) usando PDFs como referência
- **Templates** reutilizáveis com personalização ({{nome}})
- **Dashboard** com métricas de envio
- **Multi-usuário** (até 5 pessoas no time)
- **Row Level Security** — cada time vê só seus dados

---

## Setup Rápido

### 1. Supabase

1. Crie um projeto em [supabase.com](https://supabase.com)
2. Vá em **SQL Editor** e execute, nesta ordem, o conteúdo de cada arquivo em `supabase/migrations/` (001, 002, 003, 004...)
3. Em **Storage**, crie um bucket chamado `pdfs` (a migration `005_private_pdfs_cleanup.sql` deixa esse bucket privado — não precisa marcar "público" ao criar)
4. Em **Authentication → Settings**, configure o email provider
5. Crie seu primeiro usuário em **Authentication → Users**
6. No **SQL Editor**, insira seu time:

```sql
-- Substitua pelo ID do seu usuário
INSERT INTO public.teams (name, owner_id) 
VALUES ('Arquitetura Patrimonial 360°', 'SEU_USER_UUID')
RETURNING id;

-- Use o ID retornado acima
INSERT INTO public.team_members (team_id, user_id, role) 
VALUES ('TEAM_UUID_RETORNADO', 'SEU_USER_UUID', 'owner');
```

### 2. Edge Functions (Supabase CLI)

```bash
# Instale o CLI
npm install -g supabase

# Login e link
supabase login
supabase link --project-ref SEU_PROJECT_REF

# Deploy das functions
supabase functions deploy send-messages
supabase functions deploy generate-message
supabase functions deploy cleanup-pdfs
```

### 3. Cron (processar fila a cada minuto + limpar PDFs todo dia às 02h)

As migrations `004_scheduled_sending.sql` e `005_private_pdfs_cleanup.sql` já criam os
jobs do `pg_cron` (fila a cada minuto, limpeza de PDFs diária). Elas **não** guardam a
Service Role Key em texto no SQL — a chave fica no **Vault** do Supabase, fora do git.
Depois de rodar as migrations, no **SQL Editor**, rode uma única vez (troque pelos
valores reais do seu projeto):

```sql
select vault.create_secret('https://SEU_PROJETO.supabase.co', 'comunicapro_project_url');
select vault.create_secret('SUA_SERVICE_ROLE_KEY', 'comunicapro_service_role_key');
```

Para conferir se os jobs estão ativos: `select * from cron.job;`
Para ver as últimas execuções: `select * from cron.job_run_details order by start_time desc limit 10;`

### 4. Frontend

```bash
# Clone e instale
git clone https://github.com/SEU_USUARIO/comunicapro.git
cd comunicapro
npm install

# Configure variáveis
cp .env.example .env
# Edite .env com URL e ANON KEY do Supabase

# Rode local
npm run dev
```

### 5. Deploy no Netlify

1. Conecte o repo no [Netlify](https://netlify.com)
2. Build command: `npm run build`
3. Publish directory: `dist`
4. Environment variables: adicione `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`

---

## Configurações no App

Após o primeiro login, vá em **Configurações** e insira:

- **Wasender API Key** — obtida em [wasender.dev](https://wasender.dev)
- **Claude API Key** — obtida em [console.anthropic.com](https://console.anthropic.com)
- **Delay entre mensagens** — mínimo 2s (recomendado 5s)
- **Limite diário** — quantas mensagens por dia

---

## Formato do CSV de Contatos

O importador aceita variações de nome de coluna:

| Coluna     | Aceita também                         |
|------------|---------------------------------------|
| nome       | name, cliente                         |
| telefone   | phone, celular, whatsapp, fone        |
| email      | e-mail                                |
| tags       | grupo, categoria, group               |

Exemplo:
```
nome,telefone,email,tags
João Silva,31999998888,joao@email.com,"cliente,vip"
Maria Santos,31988887777,,prospect
```

---

## Custos Estimados

| Serviço     | Free Tier                          | Se ultrapassar     |
|-------------|------------------------------------|--------------------|
| Supabase    | 500MB DB, 1GB storage, 500K funcs  | ~$25/mês           |
| Netlify     | 100GB bandwidth, 300 build min     | ~$19/mês           |
| Wasender    | Por mensagem                       | Ver planos deles   |
| Claude      | Cobrado por uso (tokens)           | Ver pricing Anthropic |

**Total estimado: R$ 0/mês** no free tier, pagando apenas APIs de envio.
