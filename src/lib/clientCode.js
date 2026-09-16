// Extração do código do cliente a partir do nome do arquivo.
// Fica separado de api.js de propósito: é lógica pura, sem Supabase, usada
// tanto no app quanto nas checagens de consistência dos PDFs.

/**
 * Ex.: "Conta 355986.pdf" -> "355986"; "355986_relatorio.pdf" -> "355986"
 * Procura a primeira sequência de 4+ dígitos fora da extensão.
 */
export function extractClientCode(filename) {
  if (!filename) return null
  const name = String(filename).replace(/\.[^.]+$/, '')
  const match = name.match(/(\d{4,})/)
  return match ? match[1] : null
}
