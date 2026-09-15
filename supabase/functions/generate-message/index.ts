// Supabase Edge Function: generate-message
// Gera mensagem de WhatsApp via Claude (Anthropic), usando PDF como contexto real
// Claude lê o PDF nativamente via base64 — sem necessidade de extração de texto

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { extractBearerToken, callerBelongsToTeam } from '../_shared/auth.ts'
import { corsHeaders, handlePreflight } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight

  try {
    const { prompt, pdfId, teamId } = await req.json()

    // Nunca confia no teamId do corpo sozinho: exige que quem chamou seja
    // um usuário autenticado membro desse time.
    const authorized = await callerBelongsToTeam(extractBearerToken(req), teamId)
    if (!authorized) {
      return new Response(JSON.stringify({ error: 'Não autorizado' }), {
        status: 401,
        headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
      })
    }

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
        { status: 400, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' } },
      )
    }

    // Montar conteúdo do usuário (texto + PDF se disponível)
    const userContent: any[] = []
    let hasPdfContent = false

    // Se tem PDF, baixar e enviar como documento para o Claude ler
    if (pdfId) {
      const { data: pdf } = await supabase
        .from('pdf_library')
        .select('name, storage_path, file_url, extracted_text')
        .eq('id', pdfId)
        .single()

      if (pdf) {
        // Prioridade 1: texto já extraído (se existir)
        if (pdf.extracted_text) {
          userContent.push({
            type: 'text',
            text: `--- DOCUMENTO DO CLIENTE: "${pdf.name}" ---\n${pdf.extracted_text.slice(0, 12000)}\n--- FIM DO DOCUMENTO ---`,
          })
          hasPdfContent = true
        }
        // Prioridade 2: baixar o PDF do Storage (bucket privado) e enviar como base64 pro Claude.
        // Usa o client com Service Role, que ignora RLS/policies do bucket.
        else {
          const path = pdf.storage_path || pathFromLegacyUrl(pdf.file_url)
          if (path) {
            try {
              const { data: fileBlob, error: downloadError } = await supabase.storage.from('pdfs').download(path)
              if (downloadError) throw downloadError
              const pdfBuffer = await fileBlob.arrayBuffer()
              const pdfBase64 = toBase64(pdfBuffer)
              userContent.push({
                type: 'document',
                source: {
                  type: 'base64',
                  media_type: 'application/pdf',
                  data: pdfBase64,
                },
              })
              hasPdfContent = true
            } catch (e) {
              // Sem o PDF a mensagem sai genérica — precisa aparecer no log,
              // senão o assessor recebe um texto sem os dados do cliente e
              // não tem como saber que o documento foi ignorado.
              console.error(`Erro ao anexar PDF "${pdf.name}":`, e.message)
            }
          }
        }
      }
    }

    // Prompt do usuário
    userContent.push({
      type: 'text',
      text: hasPdfContent
        ? `INSTRUÇÃO DO ASSESSOR:\n${prompt}\n\nResponda APENAS com o texto da mensagem, sem explicações, sem aspas.`
        : `INSTRUÇÃO DO ASSESSOR:\n${prompt}\n\nATENÇÃO: Nenhum documento do cliente foi fornecido. Crie uma mensagem GENÉRICA sem citar números, valores, rentabilidade ou dados específicos.\n\nResponda APENAS com o texto da mensagem, sem explicações, sem aspas.`,
    })

    // System prompt rigoroso contra alucinação
    const systemPrompt = `Você é um redator de mensagens de WhatsApp para assessores de investimentos.

REGRAS OBRIGATÓRIAS:
1. Use SOMENTE dados que estão no documento do cliente. NUNCA invente números, valores, rentabilidade, nomes de fundos ou qualquer dado financeiro.
2. Se o documento não contém a informação pedida, diga algo genérico como "seus investimentos" — NUNCA fabrique dados.
3. Mensagem curta e direta, adequada para WhatsApp (máximo 500 caracteres).
4. Use {{nome}} onde o nome do destinatário deve aparecer.
5. Texto puro, sem markdown, sem formatação especial, sem aspas.
6. Tom: profissional, próximo, confiante. Linguagem acessível.
7. NÃO inclua saudações longas, emojis excessivos ou frases genéricas de coaching financeiro.
8. Se houver dados no PDF, cite-os de forma resumida e precisa.

PROIBIDO: inventar valores, percentuais, nomes de ativos, datas ou qualquer informação que não esteja explicitamente no documento fornecido.`

    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': team.claude_api_key,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }],
        temperature: 0.3,
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
      { headers: { ...corsHeaders(req), 'Content-Type': 'application/json' } },
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' } },
    )
  }
})

// Compatibilidade com registros criados antes do bucket "pdfs" ficar privado,
// quando só a URL pública completa era guardada (não o caminho isolado).
function pathFromLegacyUrl(fileUrl: string | null | undefined): string | null {
  if (!fileUrl) return null
  const match = fileUrl.match(/\/pdfs\/(.+)$/)
  return match ? match[1] : null
}

/**
 * Converte o PDF para base64 em blocos.
 *
 * A versão anterior fazia String.fromCharCode(...new Uint8Array(buffer)):
 * com spread, cada byte vira um argumento de função, então qualquer PDF acima
 * de ~128KB estourava com "Maximum call stack size exceeded". O erro caía no
 * catch acima e a mensagem era gerada SEM o documento — silenciosamente
 * genérica, que é o oposto do que a funcionalidade promete.
 */
function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}
