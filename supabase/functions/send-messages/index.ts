// Supabase Edge Function: send-messages
// Processa fila de mensagens e envia via Wasender API
// Docs: https://wasenderapi.com/api-docs/messages/send-text-message

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { extractBearerToken, isServiceRoleToken, callerBelongsToTeam } from '../_shared/auth.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// Restrinja ao domínio real do app: supabase functions secrets set ALLOWED_ORIGIN=https://seuapp.netlify.app
// Sem essa secret configurada, cai em '*' (mesmo comportamento de antes) — configure em produção.
const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') || '*'
const MAX_ATTEMPTS = 3

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  const callerToken = extractBearerToken(req)

  try {
    const body = await req.json().catch(() => ({}))

    // Modo 1: Envio direto (chamado pela UI de "Nova Mensagem")
    // Precisa vir de um usuário autenticado que pertence ao teamId informado —
    // nunca confiamos no teamId do corpo da requisição sozinho.
    if (body.messages && body.teamId) {
      const authorized = await callerBelongsToTeam(callerToken, body.teamId)
      if (!authorized) {
        return unauthorized()
      }
      return await sendDirect(supabase, body.messages, body.teamId)
    }

    // Modo 2: Processar fila (chamado só pelo cron, com a Service Role Key)
    if (!isServiceRoleToken(callerToken)) {
      return unauthorized()
    }
    return await processQueue(supabase)
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

function unauthorized() {
  return new Response(JSON.stringify({ error: 'Não autorizado' }), {
    status: 401,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function sendDirect(
  supabase: any,
  messages: { phone: string; content: string; mediaUrl?: string; documentUrl?: string; fileName?: string }[],
  teamId: string,
) {
  // Buscar API key do time
  const { data: team } = await supabase
    .from('teams')
    .select('wasender_api_key, settings')
    .eq('id', teamId)
    .single()

  if (!team?.wasender_api_key) {
    return new Response(JSON.stringify({ error: 'Wasender API key não configurada' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const delay = (team.settings?.delay_between_messages || 5) * 1000
  const results = []

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    try {
      const result = await sendViaWasender(team.wasender_api_key, msg.phone, msg.content, msg.mediaUrl, msg.documentUrl, msg.fileName)
      results.push({ phone: msg.phone, status: 'sent', response: result })

      // Log
      await supabase.from('message_log').insert({
        team_id: teamId,
        contact_phone: msg.phone,
        content: msg.content,
        status: 'sent',
        metadata: result,
      })
    } catch (err) {
      results.push({ phone: msg.phone, status: 'failed', error: err.message })
      await supabase.from('message_log').insert({
        team_id: teamId,
        contact_phone: msg.phone,
        content: msg.content,
        status: 'failed',
        metadata: { error: err.message },
      })
    }

    // Delay entre mensagens (não espera depois da última)
    if (i < messages.length - 1) {
      await new Promise(r => setTimeout(r, delay))
    }
  }

  return new Response(JSON.stringify({ sent: results.length, results }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function processQueue(supabase: any) {
  // Antes de processar, devolve à fila mensagens que ficaram presas em "sending"
  // (ex.: uma execução anterior foi interrompida no meio do envio).
  const { data: recovered } = await supabase.rpc('recover_stuck_messages', { p_minutes: 10 })

  // Reserva atomicamente as próximas mensagens pendentes já vencidas.
  // claim_pending_messages usa "for update skip locked", então duas execuções
  // do cron rodando ao mesmo tempo nunca pegam a mesma mensagem (sem duplicidade).
  const { data: claimed, error: claimError } = await supabase.rpc('claim_pending_messages', { p_limit: 50 })

  if (claimError) {
    return new Response(JSON.stringify({ error: claimError.message, recovered: recovered || 0 }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (!claimed || claimed.length === 0) {
    return new Response(JSON.stringify({ processed: 0, recovered: recovered || 0 }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Buscar team_id e delay configurado de cada campanha envolvida
  const campaignIds = [...new Set(claimed.map((m: any) => m.campaign_id).filter(Boolean))]
  const { data: campaigns } = await supabase
    .from('campaigns')
    .select('id, team_id, delay_seconds')
    .in('id', campaignIds)
  const campaignById: Record<string, any> = {}
  for (const c of campaigns || []) campaignById[c.id] = c

  // Buscar API key de cada time envolvido
  const teamIds = [...new Set((campaigns || []).map((c: any) => c.team_id).filter(Boolean))]
  const teams: Record<string, any> = {}
  for (const tid of teamIds) {
    const { data } = await supabase.from('teams').select('wasender_api_key, settings').eq('id', tid).single()
    if (data) teams[tid] = data
  }

  let processed = 0

  for (let i = 0; i < claimed.length; i++) {
    const msg = claimed[i]
    const campaign = campaignById[msg.campaign_id]
    const teamId = campaign?.team_id
    const team = teamId ? teams[teamId] : null

    if (!team?.wasender_api_key) {
      // Sem API key configurada: devolve pra fila como falha (não fica travada em "sending")
      await supabase.from('message_queue').update({
        status: 'failed',
        error_message: 'Wasender API key não configurada para o time',
      }).eq('id', msg.id)
      continue
    }

    try {
      const result = await sendViaWasender(team.wasender_api_key, msg.phone, msg.content, msg.media_url)
      await supabase.from('message_queue').update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        wasender_response: result,
      }).eq('id', msg.id)

      await supabase.from('message_log').insert({
        team_id: teamId,
        campaign_id: msg.campaign_id,
        contact_phone: msg.phone,
        content: msg.content,
        status: 'sent',
        metadata: result,
      })
    } catch (err) {
      // Nem todo erro é definitivo: tenta de novo até MAX_ATTEMPTS vezes,
      // com um pequeno intervalo crescente, antes de desistir da mensagem.
      const attempts = (msg.attempts || 0) + 1
      const giveUp = attempts >= MAX_ATTEMPTS
      await supabase.from('message_queue').update({
        status: giveUp ? 'failed' : 'pending',
        attempts,
        last_attempt_at: new Date().toISOString(),
        last_error: err.message,
        error_message: giveUp ? err.message : null,
        // Backoff simples: espera mais a cada nova tentativa antes de tentar de novo
        ...(giveUp ? {} : { scheduled_at: new Date(Date.now() + attempts * 5 * 60 * 1000).toISOString() }),
      }).eq('id', msg.id)
    }

    processed++
    // Espera o intervalo configurado antes da próxima mensagem (não espera após a última)
    if (i < claimed.length - 1) {
      const delay = (campaign?.delay_seconds ?? team.settings?.delay_between_messages ?? 5) * 1000
      await new Promise(r => setTimeout(r, delay))
    }
  }

  // Atualizar campanhas concluídas (sem itens pendentes/enviando na fila)
  let campaignsCompleted = 0
  for (const tid of teamIds) {
    const { data, error } = await supabase.rpc('check_completed_campaigns', { p_team_id: tid })
    if (error) console.error('check_completed_campaigns failed for team', tid, error.message)
    else campaignsCompleted += data || 0
  }

  return new Response(JSON.stringify({ processed, recovered: recovered || 0, campaignsCompleted }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function sendViaWasender(apiKey: string, phone: string, message: string, mediaUrl?: string, documentUrl?: string, fileName?: string) {
  // Docs: https://wasenderapi.com/api-docs/messages/send-text-message
  const payload: any = {
    to: phone,
    text: message,
  }

  // Se tem documento (PDF), envia como documento
  // Docs: https://wasenderapi.com/api-docs/messages/send-document-message
  if (documentUrl) {
    payload.documentUrl = documentUrl
    if (fileName) payload.fileName = fileName
  }
  // Se tem mídia (imagem), adiciona imageUrl
  // Docs: https://wasenderapi.com/api-docs/messages/send-image-message
  else if (mediaUrl) {
    payload.imageUrl = mediaUrl
  }

  const response = await fetch('https://www.wasenderapi.com/api/send-message', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`Wasender error ${response.status}: ${err}`)
  }

  return await response.json()
}
