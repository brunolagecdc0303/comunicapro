// CORS compartilhado entre as Edge Functions.
//
// Por que não basta uma origem fixa:
// a versão anterior devolvia sempre o valor cru de ALLOWED_ORIGIN no
// Access-Control-Allow-Origin. Se a página estivesse em QUALQUER outra origem
// — http em vez de https, uma URL de branch/preview do Netlify, um domínio
// próprio — o navegador rejeitava o preflight e a requisição nunca era
// enviada. No app isso aparecia como "Failed to send a request to the Edge
// Function", que parece erro de rede mas é CORS.
//
// Agora ALLOWED_ORIGIN aceita uma LISTA separada por vírgula e curingas:
//   ALLOWED_ORIGIN=https://comunicapro.netlify.app,https://*--comunicapro.netlify.app
// A origem que bater é refletida de volta; quem não bater não recebe o
// cabeçalho (o navegador bloqueia, que é o comportamento desejado).

const RAW = Deno.env.get('ALLOWED_ORIGIN') || '*'

const PATTERNS = RAW.split(',')
  .map((value) => value.trim().replace(/\/+$/, ''))
  .filter(Boolean)

function matches(pattern: string, origin: string): boolean {
  if (pattern === origin) return true
  if (!pattern.includes('*')) return false
  // Curinga só vale dentro do host, e "*" nunca atravessa um ponto —
  // https://*.exemplo.com não pode liberar https://algo.outro.com.
  const regex = new RegExp(
    '^' + pattern.split('*').map(escapeRegex).join('[^./]+') + '$',
  )
  return regex.test(origin)
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Cabeçalhos CORS para esta requisição.
 * `Vary: Origin` é obrigatório porque a resposta agora depende da origem:
 * sem ele, um cache poderia servir a uma origem a resposta liberada para outra.
 */
export function corsHeaders(req: Request): Record<string, string> {
  const origin = (req.headers.get('origin') || '').replace(/\/+$/, '')

  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }

  if (PATTERNS.includes('*')) {
    headers['Access-Control-Allow-Origin'] = '*'
  } else if (origin && PATTERNS.some((p) => matches(p, origin))) {
    headers['Access-Control-Allow-Origin'] = origin
  } else if (origin) {
    // Sem o cabeçalho o navegador bloqueia — mas deixa rastro no log,
    // senão o próximo diagnóstico volta a ser adivinhação.
    console.warn(
      `CORS: origem "${origin}" não está em ALLOWED_ORIGIN ("${RAW}") — requisição será bloqueada pelo navegador.`,
    )
  }

  return headers
}

/** Resposta ao preflight. */
export function handlePreflight(req: Request): Response | null {
  if (req.method !== 'OPTIONS') return null
  return new Response('ok', { headers: corsHeaders(req) })
}

export function jsonResponse(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  })
}
