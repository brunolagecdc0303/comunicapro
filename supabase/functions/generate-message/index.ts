// Supabase Edge Function: generate-message
// Gera mensagem de WhatsApp via Gemini API, opcionalmente usando PDF como contexto

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

    // Buscar Gemini API key do time
    const { data: team } = await supabase
      .from('teams')
      .select('gemini_api_key')
      .eq('id', teamId)
      .single()

    if (!team?.gemini_api_key) {
      return new Response(
        JSON.stringify({ error: 'Gemini API key não configurada. Vá em Configurações.' }),
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

    // Chamar Gemini
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

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${team.gemini_api_key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [{ parts: [{ text: userPrompt }] }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 600,
          },
        }),
      },
    )

    if (!geminiResponse.ok) {
      const err = await geminiResponse.text()
      throw new Error(`Gemini error: ${err}`)
    }

    const geminiData = await geminiResponse.json()
    const message = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || ''

    if (!message) {
      throw new Error('Gemini retornou resposta vazia')
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
