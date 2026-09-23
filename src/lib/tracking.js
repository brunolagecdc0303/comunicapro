// Definições compartilhadas do acompanhamento de clientes.
// A grade e o painel lateral leem daqui, para não haver duas listas de
// produtos que saem de sincronia.

/**
 * Produtos contratados. `field` é a coluna booleana em client_products;
 * `detail` (opcional) é a coluna de texto que só aparece quando o booleano
 * está marcado — ex.: marcou "Seguro de vida nacional", pergunta a seguradora.
 */
/**
 * Catálogo de produtos da esteira de cross sell.
 *
 * `detalhe` é o rótulo do complemento que só faz sentido quando há conversa
 * acontecendo (qual seguradora, qual taxa). A ordem aqui é a ordem das colunas
 * na grade.
 */
export const PRODUCTS = [
  { key: 'mb',                  label: 'Mercado Bitcoin',              short: 'MB' },
  { key: 'conta_xp',            label: 'Conta XP',                     short: 'Conta XP' },
  { key: 'conta_global_xp',     label: 'Conta global XP',              short: 'Global XP' },
  { key: 'outra_corretora',     label: 'Conta em outra corretora',     short: 'Outra corretora',
    detalhe: 'Qual corretora?' },
  { key: 'seguro_vida',         label: 'Seguro de vida',               short: 'Vida',
    detalhe: 'Qual seguradora?' },
  { key: 'seguro_vida_intl',    label: 'Seguro de vida internacional', short: 'Vida intl.' },
  { key: 'ita_internacional',   label: 'ITA (Internacional)',          short: 'ITA' },
  { key: 'consorcio',           label: 'Consórcio',                    short: 'Consórcio',
    detalhe: 'Qual consorciadora?' },
  { key: 'plano_saude',         label: 'Plano de saúde',               short: 'Saúde',
    detalhe: 'Qual operadora?' },
  { key: 'cambio',              label: 'Câmbio',                       short: 'Câmbio' },
  { key: 'eqseed',              label: 'EqSeed',                       short: 'EqSeed' },
  { key: 'az_guidance',         label: 'AZ Guidance',                  short: 'AZ Guidance',
    hint: 'Gestora de patrimônio: consolida as posições que o cliente tem em outras instituições.' },
  { key: 'pgbl',                label: 'PGBL',                         short: 'PGBL' },
  { key: 'opin',                label: 'OPIN',                         short: 'OPIN' },
  { key: 'fee_fixo',            label: 'Fee fixo (% a.a.)',            short: 'Fee fixo',
    detalhe: 'Qual taxa?' },
]

/**
 * Os estágios da planilha, na ordem em que a conversa anda. `tom` define a cor
 * do chip; `conta` marca os estágios que somam como produto efetivamente
 * ativo com o cliente.
 */
export const STATUS_PRODUTO = [
  { key: 'oferecer',      label: 'Oferecer',       tom: 'amber',   conta: false },
  { key: 'em_contato',    label: 'Em contato',     tom: 'blue',    conta: false },
  { key: 'tem_interesse', label: 'Tem interesse',  tom: 'blue',    conta: false },
  { key: 'ja_conversamos',label: 'Já conversamos', tom: 'blue',    conta: false },
  { key: 'fechou',        label: 'Fechou!',        tom: 'green',   conta: true  },
  { key: 'ja_possui',     label: 'Já possui',      tom: 'green',   conta: true  },
  { key: 'agora_nao',     label: 'No momento, não', tom: 'gray',   conta: false },
  { key: 'nao_quer',      label: 'Não quer',       tom: 'red',     conta: false },
  { key: 'negado',        label: 'Negado',         tom: 'red',     conta: false },
  { key: 'vacuo',         label: 'Vácuo',          tom: 'gray',    conta: false },
  { key: 'na',            label: 'N/A',            tom: 'gray',    conta: false },
]

export const TONS_STATUS = {
  amber: 'bg-accent-100 text-accent-600',
  blue:  'bg-navy-50 text-navy-500',
  green: 'bg-emerald-50 text-emerald-700',
  red:   'bg-red-50 text-red-700',
  gray:  'bg-gray-100 text-gray-500',
}

export const PROXIMIDADE = [
  { key: 'bem_proximo',   label: 'Bem próximo',   tom: 'green' },
  { key: 'mediano',       label: 'Mediano',       tom: 'amber' },
  { key: 'pouco_contato', label: 'Pouco contato', tom: 'red' },
  { key: 'na',            label: 'N/A',           tom: 'gray' },
]

export const INDICACAO = [
  { key: 'forneceu',         label: 'Forneceu',          tom: 'green' },
  { key: 'disse_que_indica', label: 'Disse que indica',  tom: 'blue' },
  { key: 'ja_pedi',          label: 'Já pedi',           tom: 'amber' },
  { key: 'pedir',            label: 'Pedir',             tom: 'amber' },
  { key: 'na',               label: 'N/A',               tom: 'gray' },
]

export function statusProduto(key) {
  return STATUS_PRODUTO.find(s => s.key === key) || STATUS_PRODUTO[STATUS_PRODUTO.length - 1]
}

export function rotuloDe(lista, key) {
  return lista.find(x => x.key === key)?.label || null
}

/** Produtos efetivamente ativos (fechou ou já possui). */
export function contarAtivos(statusPorProduto) {
  return PRODUCTS.filter(p => statusProduto(statusPorProduto?.[p.key]?.status).conta).length
}

/** Produtos que ainda valem uma abordagem — é a fila de trabalho do assessor. */
export function contarAbertos(statusPorProduto) {
  const abertos = new Set(['oferecer', 'em_contato', 'tem_interesse', 'ja_conversamos'])
  return PRODUCTS.filter(p => abertos.has(statusPorProduto?.[p.key]?.status)).length
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

// ============================================
// LEMBRETES RECORRENTES
// ============================================
export const FREQUENCIAS = [
  { key: 'mensal',  label: 'Todo mês' },
  { key: 'semanal', label: 'Toda semana' },
]

export const DIAS_DA_SEMANA = [
  { key: 0, label: 'domingo' }, { key: 1, label: 'segunda' }, { key: 2, label: 'terça' },
  { key: 3, label: 'quarta' },  { key: 4, label: 'quinta' },  { key: 5, label: 'sexta' },
  { key: 6, label: 'sábado' },
]

/**
 * A regra bate com esta data?
 * Espelha public.fp_lembrete_vence_em — inclusive o ajuste de fim de mês:
 * "todo dia 31" em fevereiro cai no dia 28 (ou 29), senão o mês seria pulado
 * em silêncio e o assessor nunca saberia.
 */
export function venceEm(lembrete, date) {
  if (!lembrete || !date) return false
  if (lembrete.frequencia === 'semanal') return date.getDay() === lembrete.dia_da_semana
  if (lembrete.frequencia !== 'mensal') return false
  const ultimoDoMes = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  return date.getDate() === Math.min(lembrete.dia_do_mes, ultimoDoMes)
}

/** Próxima data em que o lembrete dispara, ou null se a regra já terminou. */
export function proximoEnvio(lembrete, hoje = new Date()) {
  if (!lembrete || !lembrete.ativo) return null
  const inicio = parseDateOnly(lembrete.inicio)
  const fim = parseDateOnly(lembrete.fim)
  let d = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate())
  if (inicio && inicio > d) d = inicio

  // 400 dias cobrem qualquer regra mensal ou semanal.
  for (let i = 0; i < 400; i++) {
    if (fim && d > fim) return null
    if (venceEm(lembrete, d)) return d
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
  }
  return null
}

/** "Todo dia 15, às 09:00" — a regra em uma linha. */
export function descreverRecorrencia(lembrete) {
  if (!lembrete) return ''
  const hora = String(lembrete.hora || '09:00').slice(0, 5)
  if (lembrete.frequencia === 'semanal') {
    const dia = DIAS_DA_SEMANA.find(d => d.key === lembrete.dia_da_semana)
    return `Toda ${dia?.label || 'semana'}, às ${hora}`
  }
  return `Todo dia ${lembrete.dia_do_mes}, às ${hora}`
}
