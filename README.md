# ComunicaPro

Plataforma de comunicação em massa via WhatsApp para assessores de investimentos.

**Stack:** React + Vite + Tailwind (Netlify) | Supabase (DB, Auth, Edge Functions, Cron)

---

## Funcionalidades

- **Mensagens em massa** via Wasender API com delay anti-bloqueio
- **Agendamento** de campanhas para data/hora específica
- **Import de contatos** via CSV (aceita variações de colunas)
- **Geração de mensagens com IA** (Gemini) usando PDFs como referência
- **Templates** reutilizáveis com personalização ({{nome}})
- **Dashboard** com métricas de envio
- **Multi-usuário** (até 5 pessoas no time)
- **Row Level Security** — cada time vê só seus dados

---

## Setup Rápido

### 1. Supabase

1. Crie um projeto em [supabase.com](https://supabase.com)
2. Vá em **SQL Editor** e execute o conteúdo de `supabase/migrations/001_initial_schema.sql`
3. Em **Storage**, crie um bucket chamado `pdfs` (público)
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
```

### 3. Cron (processar fila a cada minuto)

No **SQL Editor** do Supabase:

```sql
SELECT cron.schedule(
  'process-message-queue',
  '* * * * *',
  $$
  SELECT net.http_post(
    'https://SEU_PROJECT.supabase.co/functions/v1/send-messages',
    '{}',
    'application/json',
    ARRAY[
      net.http_header('Authorization', 'Bearer SEU_SERVICE_ROLE_KEY')
    ]
  )
  $$
);
```

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
- **Gemini API Key** — obtida em [ai.google.dev](https://ai.google.dev)
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
| Gemini      | Free tier generoso                 | Ver pricing Google  |

**Total estimado: R$ 0/mês** no free tier, pagando apenas APIs de envio.
