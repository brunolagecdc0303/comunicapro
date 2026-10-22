// Supabase Edge Function: processar-fp
//
// Chamada pela tela de Acompanhamento logo depois que o assessor sobe o PDF do FP
// (documento gerado pela XP). Faz duas coisas, independentes entre si:
//   1. Lê o PDF com o Claude e devolve SUGESTÕES de combinados. Não grava nada:
//      quem decide o que entra é o assessor, na tela.
//   2. Copia o PDF para a pasta do cliente no Google Drive, pelo script do Google
//      configurado em teams.settings.drive_webhook_url (+ drive_webhook_token).
// Se uma das duas falhar, a outra segue, e o FP continua registrado de qualquer jeito.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { extractBearerToken, callerBelongsToTeam } from '../_shared/auth.ts'
import { corsHeaders, handlePreflight } from '../_shared/cors.ts'

const PASTA_RAIZ_PADRAO = '1HoblaAQo1gA_pekCnbisPlcwhqKQSn6h' // "Diagnósticos 360"

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
    })

  try {
    const { teamId, cicloId } = await req.json()
    if (!(await callerBelongsToTeam(extractBearerToken(req), teamId))) {
      return json({ error: 'Não autorizado' }, 401)
    }

    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    const { data: ciclo } = await db.from('fp_cycles')
      .select('id, team_id, contact_id, pdf_path, pdf_nome, completed_at')
      .eq('id', cicloId).eq('team_id', teamId).single()
    if (!ciclo?.pdf_path) return json({ error: 'Ciclo sem PDF' }, 400)

    const [{ data: team }, { data: contato }, { data: perfil }, { data: diag }] = await Promise.all([
      db.from('teams').select('claude_api_key, settings').eq('id', teamId).single(),
      db.from('contacts').select('name').eq('id', ciclo.contact_id).single(),
      db.from('client_profile').select('pasta_drive_url').eq('contact_id', ciclo.contact_id).maybeSingle(),
      db.from('diagnosticos_360').select('cliente_nome, pasta_url').eq('contact_id', ciclo.contact_id)
        .order('data_reuniao', { ascending: false }).limit(1).maybeSingle(),
    ])

    const { data: arquivo, error: dlErr } = await db.storage.from('pdfs').download(ciclo.pdf_path)
    if (dlErr || !arquivo) return json({ error: 'Não consegui baixar o PDF' }, 500)
    const base64 = toBase64(await arquivo.arrayBuffer())

    // O nome que vale é o do diagnóstico (completo); o do contato vem truncado do export da XP.
    const nomeCliente = diag?.cliente_nome || contato?.name || 'Cliente'

    const [combinados, drive] = await Promise.all([
      lerCombinados(team?.claude_api_key, base64).catch((e) => {
        console.error('leitura do FP falhou:', e)
        return []
      }),
      copiarParaDrive({
        url: team?.settings?.drive_webhook_url,
        token: team?.settings?.drive_webhook_token,
        raiz: team?.settings?.drive_pasta_raiz || PASTA_RAIZ_PADRAO,
        pastaUrl: perfil?.pasta_drive_url || diag?.pasta_url || null,
        cliente: nomeCliente,
        nomeArquivo: `${ciclo.completed_at || ''} FP XP - ${nomeCliente}.pdf`.trim(),
        base64,
      }),
    ])

    if (drive.ok) {
      await db.from('fp_cycles').update({ pdf_drive_url: drive.fileUrl }).eq('id', ciclo.id)
      if (drive.folderUrl) {
        await db.from('client_profile').upsert(
          { team_id: teamId, contact_id: ciclo.contact_id, pasta_drive_url: drive.folderUrl },
          { onConflict: 'contact_id' },
        )
      }
    }

    return json({ combinados, drive })
  } catch (err) {
    console.error(err)
    return json({ error: String(err?.message || err) }, 500)
  }
})

async function lerCombinados(apiKey: string | undefined, base64: string): Promise<string[]> {
  if (!apiKey) return []
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1200,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
          {
            type: 'text',
            text: `Este é um Financial Planning gerado pela XP para um cliente.
Liste as ações concretas que o cliente e o assessor precisam executar para colocar o plano em prática
(ex.: "Aumentar o aporte mensal para R$ 5 mil", "Revisar o seguro de vida", "Abrir previdência PGBL").

Regras:
- Só o que está no documento. Nunca invente valores, prazos ou produtos.
- Cada item curto (até 12 palavras), começando por verbo no infinitivo.
- No máximo 10 itens, do mais importante para o menos.
- Responda APENAS com um array JSON de strings, sem texto antes ou depois.`,
          },
        ],
      }],
    }),
  })
  if (!resp.ok) throw new Error(`Claude ${resp.status}: ${await resp.text()}`)
  const data = await resp.json()
  const texto = (data.content?.[0]?.text || '').trim()
  const inicio = texto.indexOf('['), fim = texto.lastIndexOf(']')
  if (inicio < 0 || fim < inicio) return []
  const lista = JSON.parse(texto.slice(inicio, fim + 1))
  return Array.isArray(lista) ? lista.filter((x) => typeof x === 'string' && x.trim()).slice(0, 10) : []
}

async function copiarParaDrive(p: {
  url?: string; token?: string; raiz: string; pastaUrl: string | null
  cliente: string; nomeArquivo: string; base64: string
}): Promise<{ ok: boolean; fileUrl?: string; folderUrl?: string; motivo?: string }> {
  if (!p.url || !p.token) {
    return { ok: false, motivo: 'Cópia no Drive ainda não configurada (falta publicar o script do Google).' }
  }
  try {
    const resp = await fetch(p.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        token: p.token,
        raiz: p.raiz,
        pastaId: pastaIdDaUrl(p.pastaUrl),
        cliente: p.cliente,
        nomeArquivo: p.nomeArquivo,
        base64: p.base64,
      }),
      redirect: 'follow',
    })
    const corpo = await resp.json().catch(() => null)
    if (!resp.ok || !corpo?.ok) return { ok: false, motivo: `Drive: ${corpo?.erro || resp.status}` }
    return { ok: true, fileUrl: corpo.fileUrl, folderUrl: corpo.folderUrl }
  } catch (e) {
    return { ok: false, motivo: `Drive indisponível: ${e?.message || e}` }
  }
}

function pastaIdDaUrl(url: string | null): string | null {
  if (!url) return null
  const m = url.match(/folders\/([A-Za-z0-9_-]+)/)
  return m ? m[1] : null
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}
