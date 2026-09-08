// Definições compartilhadas do acompanhamento de clientes.
// A grade e o painel lateral leem daqui, para não haver duas listas de
// produtos que saem de sincronia.

/**
 * Produtos contratados. `field` é a coluna booleana em client_products;
 * `detail` (opcional) é a coluna de texto que só aparece quando o booleano
 * está marcado — ex.: marcou "Seguro de vida nacional", pergunta a seguradora.
 */
export const PRODUCTS = [
  { field: 'mb',                    label: 'MB',                     short: 'MB' },
  { field: 'conta_xp',              label: 'Conta XP',               short: 'XP' },
  { field: 'conta_outra_corretora', label: 'Conta em outra corretora', short: 'Outra corretora',
    detail: { field: 'outra_corretora', label: 'Qual corretora?' } },
  { field: 'seguro_vida_nacional',  label: 'Seguro de vida nacional', short: 'Vida BR',
    detail: { field: 'seguradora_vida', label: 'Qual seguradora?' } },
  { field: 'seguro_vida_intl',      label: 'Seguro de vida internacional', short: 'Vida intl.' },
  { field: 'consorcio',             label: 'Consórcio',              short: 'Consórcio',
    detail: { field: 'consorciadora', label: 'Qual consorciadora?' } },
  { field: 'plano_saude',           label: 'Plano de saúde',         short: 'Saúde',
    detail: { field: 'operadora_saude', label: 'Qual operadora?' } },
  { field: 'cambio',                label: 'Câmbio',                 short: 'Câmbio' },
  { field: 'eqseed',                label: 'EqSeed',                 short: 'EqSeed' },
  { field: 'az_guidance',           label: 'AZ Guidance',            short: 'AZ Guid.' },
]

export const PRODUCT_FIELDS = PRODUCTS.flatMap(p =>
  p.detail ? [p.field, p.detail.field] : [p.field]
)

/** Quantos produtos o cliente tem contratados. */
export function countProducts(products) {
  if (!products) return 0
  return PRODUCTS.filter(p => products[p.field]).length
}

/**
 * Estágio do FP a partir do ciclo atual.
 * As três situações não são exclusivas — mostramos a mais avançada.
 */
export function fpStage(cycle) {
  if (!cycle) return { key: 'sem_fp', label: 'Sem FP', tone: 'gray' }
  if (cycle.in_execution) return { key: 'em_execucao', label: 'Em execução', tone: 'green' }
  if (cycle.completed_at) return { key: 'realizado', label: 'Realizado', tone: 'blue' }
  if (cycle.meeting_scheduled_at) return { key: 'agendada', label: 'Reunião agendada', tone: 'amber' }
  return { key: 'sem_fp', label: 'Sem FP', tone: 'gray' }
}

export const STAGE_TONES = {
  gray:  'bg-gray-100 text-gray-500',
  amber: 'bg-accent-100 text-accent-600',
  blue:  'bg-navy-50 text-navy-500',
  green: 'bg-emerald-50 text-emerald-700',
}

/**
 * Situação da data do próximo FP, para destacar o que está vencendo.
 * Retorna null quando não há próximo FP marcado.
 */
export function nextFPStatus(nextDate, today = new Date()) {
  if (!nextDate) return null
  const target = parseDateOnly(nextDate)
  if (!target) return null

  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const days = Math.round((target - start) / 86400000)

  if (days < 0)  return { days, label: `Atrasado ${Math.abs(days)}d`, tone: 'bg-red-50 text-red-700' }
  if (days === 0) return { days, label: 'Hoje',        tone: 'bg-red-50 text-red-700' }
  if (days <= 30) return { days, label: `Em ${days}d`, tone: 'bg-accent-100 text-accent-600' }
  return { days, label: formatDate(nextDate), tone: 'bg-gray-100 text-gray-500' }
}

/**
 * Lê 'YYYY-MM-DD' como data local.
 * new Date('2026-03-10') seria interpretado como UTC e, em fuso negativo,
 * voltaria um dia — o que faria um FP de hoje aparecer como atrasado.
 */
export function parseDateOnly(value) {
  if (!value) return null
  const [y, m, d] = String(value).slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}

export function formatDate(value) {
  const date = parseDateOnly(value)
  if (!date) return '—'
  return date.toLocaleDateString('pt-BR')
}

/** Combinados: texto (uma linha por item) <-> jsonb [{texto, feito}] */
export function combinadosToText(combinados) {
  if (!Array.isArray(combinados)) return ''
  return combinados.map(c => c?.texto ?? '').filter(Boolean).join('\n')
}

export function textToCombinados(text, previous = []) {
  const doneByText = new Map(
    (Array.isArray(previous) ? previous : []).map(c => [c?.texto, !!c?.feito])
  )
  return String(text || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(texto => ({ texto, feito: doneByText.get(texto) ?? false }))
}
