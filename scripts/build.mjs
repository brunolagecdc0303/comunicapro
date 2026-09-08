// Build do ComunicaPro.
//
// O Netlify deste projeto não roda o build: ele publica o `dist/` que está
// versionado no repositório (netlify.toml -> command = "echo 'Using pre-built dist'").
// Além disso, a raiz guarda uma cópia do app buildado, usada nos deploys via API.
//
// Isso significa que o index.html da raiz é um ARTEFATO, não a fonte. A fonte é
// o index.dev.html (o único que aponta para /src/main.jsx). Este script cuida da
// troca, para ninguém precisar lembrar da ordem certa:
//
//   index.dev.html -> index.html -> vite build -> dist/ -> cópia na raiz
//
// Rode sempre `npm run build` antes de commitar mudanças em src/.

import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const entry = join(root, 'index.html')
const source = join(root, 'index.dev.html')

if (!existsSync(source)) {
  console.error('index.dev.html não encontrado — ele é a fonte do build.')
  process.exit(1)
}

// 0. As variáveis do Supabase são embutidas no bundle em tempo de build.
// Buildar sem elas gera um app que quebra no navegador (createClient(undefined))
// — e, como o dist/ vai versionado, o erro só apareceria em produção.
// Melhor falhar aqui.
const required = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']
const envFile = join(root, '.env')
const env = { ...process.env }
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf-8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (match) env[match[1]] ??= match[2].replace(/^["']|["']$/g, '')
  }
}
const missing = required.filter(name => !env[name])
if (missing.length) {
  console.error(`\nFaltam variáveis de ambiente: ${missing.join(', ')}`)
  console.error('Crie um .env na raiz (veja .env.example) antes de buildar.')
  console.error('Sem elas o bundle sai quebrado e o dist/ versionado leva o erro para produção.\n')
  process.exit(1)
}

// 1. Coloca a fonte no lugar que o Vite espera.
copyFileSync(source, entry)

// 2. Build.
execFileSync('npx', ['vite', 'build'], { cwd: root, stdio: 'inherit', env })

// 3. Espelha o resultado na raiz (assets antigos saem, senão acumulam a cada build).
const distAssets = join(root, 'dist', 'assets')
const rootAssets = join(root, 'assets')
rmSync(rootAssets, { recursive: true, force: true })
mkdirSync(rootAssets, { recursive: true })
for (const file of readdirSync(distAssets)) {
  copyFileSync(join(distAssets, file), join(rootAssets, file))
}
copyFileSync(join(root, 'dist', 'index.html'), entry)

console.log('\nBuild pronto: dist/ e cópia na raiz atualizados.')
console.log('Commite dist/, assets/ e index.html junto com as mudanças de src/.')
