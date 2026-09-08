# ComunicaPro

Plataforma de comunicação em massa via WhatsApp para assessores de investimentos.

**Stack:** React + Vite + Tailwind (Netlify) | Supabase (DB, Auth, Edge Functions, Cron)

---

## Funcionalidades

- **Acompanhamento de clientes** — visão consolidada em formato de planilha, com aba de
  Financial Planning (reunião agendada, FP realizado, em execução, data do próximo FP e os
  principais combinados a monitorar) e aba de produtos contratados; exporta para CSV
- **Mensagens em massa** via Wasender API com delay anti-bloqueio
- **Envios Programados** — agende campanhas para data/hora específica, acompanhe o status (programado, processando, concluído, erro, cancelado) e cancele antes do horário
- **Processamento automático** da fila via `pg_cron` a cada minuto, com proteção contra envio duplicado (reserva atômica) e recuperação de mensagens travadas
- **PDFs privados com limpeza automática** — bucket não-público, acesso só via URL assinada e temporária; arquivos com mais de 7 dias são apagados todo dia às 02:00
- **Import de contatos** via CSV (aceita variações de colunas)
- **Geração de mensagens com IA** (Claude) usando PDFs como referência
- **Templates** reutilizáveis com personalização ({{nome}})
- **Dashboard** com métricas de envio
- **Multi-usuário** (até 5 pessoas no time)
- **Row Level Security** — cada time vê só seus dados, com papéis (owner/admin/member) aplicados de verdade na gestão do time
- **Retry automático** — falha de envio tenta de novo até 3x antes de marcar como erro
- **Edge Functions autenticadas** — nunca confiam num `teamId` enviado pelo cliente sem checar se quem chamou é membro daquele time

---

## Setup Rápido

### 1. Supabase

1. Crie um projeto em [supabase.com](https://supabase.com)
2. Vá em **SQL Editor** e execute, nesta ordem, o conteúdo de cada arquivo em `supabase/migrations/` (001, 002, 003, 004, 005, 006, 007, 008...)
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

# Restrinja o CORS ao domínio real do seu app (troque pela URL do Netlify/domínio próprio).
# Sem isso configurado, as functions aceitam requisições de qualquer origem (padrão anterior).
supabase secrets set ALLOWED_ORIGIN=https://seuapp.netlify.app
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` já ficam disponíveis
automaticamente dentro das Edge Functions — não precisa cadastrá-los como secret.

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

O Netlify **não** roda o build deste projeto: o `netlify.toml` publica o `dist/` que está
versionado no repositório (e a raiz guarda uma cópia, usada nos deploys via API).

Por isso, **toda mudança em `src/` só chega no ar depois de rodar o build e commitar o
resultado**:

```bash
npm run build            # gera dist/ e atualiza a cópia na raiz
git add dist assets index.html src
git commit -m "..."
```

O `npm run build` (`scripts/build.mjs`) cuida da ordem certa — `index.dev.html` é a fonte,
`index.html` da raiz é artefato — e **falha** se `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`
não estiverem no `.env`. Isso é proposital: essas variáveis são embutidas no bundle em tempo
de build, e um build sem elas geraria um site quebrado — que, por ir versionado, chegaria em
produção sem aviso.

Se preferir que o Netlify passe a buildar sozinho, troque o `command` do `netlify.toml` para
`npm run build:vite`, configure `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` nas variáveis
de ambiente do painel e pare de versionar o `dist/`.

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

## Segurança

- **Edge Functions autenticadas** — `send-messages` (modo envio direto) e `generate-message`
  validam que quem chamou é um usuário autenticado membro do `teamId` informado, antes de
  fazer qualquer coisa. O modo de processamento da fila (`send-messages`) e a `cleanup-pdfs`
  só aceitam chamadas com a Service Role Key (ou seja, só o `pg_cron`).
- **CORS restrito** — configure `ALLOWED_ORIGIN` (passo 2 acima) com o domínio real do app.
- **Chaves de API** (Wasender, Claude) ficam em `teams`, protegidas por RLS (só membros do
  próprio time leem/editam) e só são buscadas pelo frontend na tela de Configurações — não
  ficam carregadas na memória do app em todas as páginas.
- **Papéis no time** — só `owner`/`admin` adicionam, promovem ou removem membros; ninguém
  altera o próprio papel; qualquer um pode sair do time sozinho (migration `006`).
- **RLS consistente** — todas as tabelas (`contacts`, `campaigns`, `message_queue`,
  `message_log`, `pdf_library`, `teams`, `team_members`, `message_templates`,
  `fp_cycles`, `client_products`) restringem acesso ao time do usuário autenticado.
- **CPF e documentos nunca sobem** — o banco não tem coluna para CPF, RG, data de
  nascimento ou conta bancária; o cliente é identificado pelo `client_code` (código da
  conta). O app aplica a regra na entrada, em `src/lib/privacy.js`:
  colunas de CSV com nome de documento são descartadas na importação, e os campos de
  texto livre do acompanhamento avisam e removem o CPF antes de salvar. A validação usa
  os dígitos verificadores do CPF — um celular brasileiro também tem 11 dígitos e não
  pode ser confundido com documento.
- **Repositório público** — este repo é público. Nunca commite `.env`, dumps de banco ou
  planilhas de cliente. A `VITE_SUPABASE_ANON_KEY` embutida no bundle é pública por
  design (é a chave *publishable*, feita para rodar no navegador); quem protege os dados
  é a RLS. A `service_role`, essa sim secreta, só existe no Vault do Supabase e nas
  Edge Functions.
- **Atividade real no projeto** — os crons (fila a cada minuto, limpeza diária de PDFs)
  já geram uso legítimo e recorrente do banco, o que ajuda a evitar a pausa por
  inatividade do plano free do Supabase — mas não é garantia absoluta; se o projeto ficar
  muito tempo sem uso do app em si, verifique o status no painel do Supabase de vez em quando.

## Backup

O código (frontend, migrations, Edge Functions) já fica versionado no GitHub. Para não
depender só do Supabase para os *dados*, há um workflow de backup semanal do Postgres em
`.github/workflows/backup-database.yml`.

**Configuração (uma vez):**
1. Em Supabase → **Project Settings → Database**, copie a *Connection string* (URI), com a senha do banco.
2. No GitHub, vá em **Settings → Secrets and variables → Actions** e crie o secret `SUPABASE_DB_URL` com esse valor.

O workflow roda todo domingo (05:00 UTC) e também pode ser disparado manualmente em
**Actions → Backup do banco (Supabase) → Run workflow**. Cada execução publica um `.dump`
como artifact do GitHub Actions (guardado por 90 dias).

**Para restaurar** um backup: baixe o `.dump` do artifact e rode
`pg_restore --clean --if-exists -d "SUA_CONNECTION_STRING" arquivo.dump`.

---

## Custos Estimados

| Serviço     | Free Tier                          | Se ultrapassar     |
|-------------|------------------------------------|--------------------|
| Supabase    | 500MB DB, 1GB storage, 500K funcs  | ~$25/mês           |
| Netlify     | 100GB bandwidth, 300 build min     | ~$19/mês           |
| Wasender    | Por mensagem                       | Ver planos deles   |
| Claude      | Cobrado por uso (tokens)           | Ver pricing Anthropic |

**Total estimado: R$ 0/mês** no free tier, pagando apenas APIs de envio.
