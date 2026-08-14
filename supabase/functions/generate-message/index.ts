// Supabase Edge Function: generate-message
// Gera mensagem de WhatsApp via Claude (Anthropic), opcionalmente usando PDF como contexto

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { prompt, pdfId, teamId } = await req.json()

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Buscar Claude API key do time
    const { data: team } = await supabase
      .from('teams')
      .select('claude_api_key')
      .eq('id', teamId)
      .single()

    if (!team?.claude_api_key) {
      return new Response(
        JSON.stringify({ error: 'Claude API key não configurada. Vá em Configurações.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // Se tem PDF, buscar texto extraído
    let pdfContext = ''
    if (pdfId) {
      const { data: pdf } = await supabase
        .from('pdf_library')
        .select('name, extracted_text')
        .eq('id', pdfId)
        .single()

      if (pdf?.extracted_text) {
        pdfContext = `\n\nDocumento de referência "${pdf.name}":\n${pdf.extracted_text.slice(0, 8000)}`
      }
    }

    // Chamar Claude (Anthropic Messages API)
    const systemPrompt = `Você é um redator especializado em comunicação financeira via WhatsApp para assessores de investimentos.

Regras:
- Escreva mensagens curtas e diretas, adequadas para WhatsApp
- Use linguagem profissional mas acessível
- Não use markdown, apenas texto puro
- Use {{nome}} onde o nome do destinatário deve aparecer
- Máximo 500 caracteres por mensagem
- Tom: confiante, educativo, próximo
- Se houver um PDF de referência, extraia os pontos mais relevantes e incorpore na mensagem
- Não invente dados, use apenas o que está no documento`

    const userPrompt = `Crie uma mensagem de WhatsApp com base nesta instrução:

${prompt}${pdfContext}

Responda APENAS com o texto da mensagem, sem explicações.`

    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': team.claude_api_key,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 600,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        temperature: 0.7,
      }),
    })

    if (!claudeResponse.ok) {
      const err = await claudeResponse.text()
      throw new Error(`Claude error ${claudeResponse.status}: ${err}`)
    }

    const claudeData = await claudeResponse.json()
    const message = claudeData.content?.[0]?.text || ''

    if (!message) {
      throw new Error('Claude retornou resposta vazia')
    }

    return new Response(
      JSON.stringify({ message: message.trim() }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
