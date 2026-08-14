// Supabase Edge Function: send-messages
// Processa fila de mensagens e envia via Wasender API
// Docs: https://wasenderapi.com/api-docs/messages/send-text-message

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  try {
    const body = await req.json().catch(() => ({}))

    // Modo 1: Envio direto (chamado pela UI de "Nova Mensagem")
    if (body.messages && body.teamId) {
      return await sendDirect(supabase, body.messages, body.teamId)
    }

    // Modo 2: Processar fila (chamado pelo cron)
    return await processQueue(supabase)
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

async function sendDirect(
  supabase: any,
  messages: { phone: string; content: string; mediaUrl?: string }[],
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

  for (const msg of messages) {
    try {
      const result = await sendViaWasender(team.wasender_api_key, msg.phone, msg.content, msg.mediaUrl)
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

    // Delay entre mensagens
    if (messages.indexOf(msg) < messages.length - 1) {
      await new Promise(r => setTimeout(r, delay))
    }
  }

  return new Response(JSON.stringify({ sent: results.length, results }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function processQueue(supabase: any) {
  // Buscar mensagens pendentes que já passaram do horário agendado
  const { data: pending } = await supabase
    .from('message_queue')
    .select('*, campaigns(team_id, delay_seconds)')
    .eq('status', 'pending')
    .lte('scheduled_at', new Date().toISOString())
    .order('scheduled_at')
    .limit(50)

  if (!pending || pending.length === 0) {
    return new Response(JSON.stringify({ processed: 0 }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Agrupar por team_id para buscar API keys
  const teamIds = [...new Set(pending.map((p: any) => p.campaigns?.team_id).filter(Boolean))]
  const teams: Record<string, any> = {}

  for (const tid of teamIds) {
    const { data } = await supabase.from('teams').select('wasender_api_key, settings').eq('id', tid).single()
    if (data) teams[tid] = data
  }

  let processed = 0

  for (const msg of pending) {
    const teamId = msg.campaigns?.team_id
    const team = teams[teamId]
    if (!team?.wasender_api_key) continue

    // Marcar como enviando
    await supabase.from('message_queue').update({ status: 'sending' }).eq('id', msg.id)

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
      await supabase.from('message_queue').update({
        status: 'failed',
        error_message: err.message,
      }).eq('id', msg.id)
    }

    processed++
    const delay = (team.settings?.delay_between_messages || 5) * 1000
    await new Promise(r => setTimeout(r, delay))
  }

  // Atualizar campanhas concluídas
  for (const tid of teamIds) {
    await supabase.rpc('check_completed_campaigns', { p_team_id: tid }).catch(() => {})
  }

  return new Response(JSON.stringify({ processed }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function sendViaWasender(apiKey: string, phone: string, message: string, mediaUrl?: string) {
  // Docs: https://wasenderapi.com/api-docs/messages/send-text-message
  const payload: any = {
    to: phone,
    text: message,
  }

  // Se tem mídia (imagem), adiciona imageUrl
  // Docs: https://wasenderapi.com/api-docs/messages/send-image-message
  if (mediaUrl) {
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
