// Jornada do cliente: quem está em que etapa do método e o que pede ação hoje.
//
// Regra de ouro: etapa e atraso são CALCULADOS a partir do que aconteceu
// (diagnóstico registrado, FP entregue, combinados feitos, mensagens enviadas).
// Nada aqui é digitado à mão, para o quadro não ficar desatualizado.

import { supabase } from './supabase'
import { parseDateOnly } from './tracking'

export const ETAPAS = [
  { key: 'sem_diagnostico', label: 'Sem diagnóstico', hint: 'Ainda sem Diagnóstico 360' },
  { key: 'diagnostico', label: 'Diagnóstico feito', hint: 'Falta entregar o FP' },
  { key: 'implantacao', label: 'FP entregue', hint: 'Combinados em implantação' },
  { key: 'acompanhamento', label: 'Em acompanhamento', hint: 'FP em dia' },
]

const CADENCIA_PADRAO = { A: [30, 90], B: [90, 180], C: [180, 365], D: [365, 365] }

/** Carrega tudo o que a jornada precisa numa ida só. */
export async function getJornada(teamId) {
  const [contatos, perfis, ciclos, diags, contatosRecentes, cadencia] = await Promise.all([
    supabase.from('contacts').select('id, name, phone, client_code').eq('team_id', teamId).order('name'),
    supabase.from('client_profile').select('*').eq('team_id', teamId),
    supabase.from('fp_cycles').select('*').eq('team_id', teamId).order('created_at', { ascending: false }),
    supabase.from('diagnosticos_360').select('*').eq('team_id', teamId).order('data_reuniao', { ascending: false }),
    supabase.from('v_ultimo_contato').select('contact_id, ultimo_envio').eq('team_id', teamId),
    supabase.from('tier_cadence').select('*'),
  ])
  for (const r of [contatos, perfis, ciclos, diags, contatosRecentes]) if (r.error) throw r.error
  return montarJornada({
    contatos: contatos.data, perfis: perfis.data, ciclos: ciclos.data, diags: diags.data,
    ultimos: contatosRecentes.data, cad: cadencia.data,
  })
}

/** Parte pura: recebe as linhas do banco e devolve a jornada pronta. */
export function montarJornada({ contatos, perfis = [], ciclos = [], diags = [], ultimos = [], cad: linhasCad = [] }) {
  const cad = { ...CADENCIA_PADRAO }
  for (const linha of linhasCad || []) cad[linha.tier] = [linha.dias_entre_contatos, linha.dias_entre_revisoes]

  const perfilPor = new Map(perfis.map(p => [p.contact_id, p]))
  const ultimoPor = new Map(ultimos.map(u => [u.contact_id, u.ultimo_envio]))
  const ciclosPor = agrupar(ciclos, 'contact_id')
  const diagsPor = agrupar(diags.filter(d => d.contact_id), 'contact_id')

  const clientes = contatos.map(c => montarCliente(c, {
    perfil: perfilPor.get(c.id) || null,
    ciclos: ciclosPor.get(c.id) || [],
    diags: diagsPor.get(c.id) || [],
    ultimoEnvio: ultimoPor.get(c.id) || null,
    cadencia: cad,
  }))

  return {
    clientes,
    semVinculo: diags.filter(d => !d.contact_id),
    cadencia: cad,
  }
}

function agrupar(linhas, chave) {
  const mapa = new Map()
  for (const l of linhas) {
    if (!mapa.has(l[chave])) mapa.set(l[chave], [])
    mapa.get(l[chave]).push(l)
  }
  return mapa
}

function diasEntre(a, b = new Date()) {
  if (!a) return null
  const d = a instanceof Date ? a : (parseDateOnly(a) || new Date(a))
  if (!d || isNaN(d)) return null
  const hoje = new Date(b.getFullYear(), b.getMonth(), b.getDate())
  const dia = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  return Math.round((hoje - dia) / 86400000)
}

/** Monta o cliente com etapa, alertas e o que exibir no card. */
export function montarCliente(contato, { perfil, ciclos, diags, ultimoEnvio, cadencia }) {
  const fp = ciclos.find(c => c.completed_at) || null
  const cicloAberto = ciclos.find(c => !c.completed_at) || null
  const diag = diags[0] || null
  const combinados = fp?.combinados || []
  const pendentes = combinados.filter(x => !x.feito)

  let etapa = 'sem_diagnostico'
  if (fp) etapa = combinados.length > 0 && pendentes.length === 0 ? 'acompanhamento' : 'implantacao'
  else if (diag) etapa = 'diagnostico'

  // Último contato = o mais recente entre mensagem enviada, reunião de diagnóstico e entrega do FP.
  const datas = [ultimoEnvio, diag?.data_reuniao, fp?.completed_at].filter(Boolean)
    .map(v => parseDateOnly(v) || new Date(v)).filter(d => !isNaN(d))
  const ultimoContato = datas.length ? new Date(Math.max(...datas)) : null
  const diasSemContato = diasEntre(ultimoContato)

  const tier = perfil?.tier || null
  const [diasContato] = cadencia[tier || 'B']

  const alertas = []
  const proxRevisao = fp?.next_fp_date
  const diasParaRevisao = proxRevisao != null ? -diasEntre(proxRevisao) : null
  if (diasParaRevisao != null && diasParaRevisao < 0)
    alertas.push({ tipo: 'revisao', urg: 3, texto: `Revisão do FP atrasada ${-diasParaRevisao}d` })
  else if (diasParaRevisao != null && diasParaRevisao <= 15)
    alertas.push({ tipo: 'revisao', urg: 2, texto: diasParaRevisao === 0 ? 'Revisão do FP hoje' : `Revisão do FP em ${diasParaRevisao}d` })

  if (perfil?.proximo_passo_data) {
    const d = diasEntre(perfil.proximo_passo_data)
    if (d > 0) alertas.push({ tipo: 'passo', urg: 3, texto: `Próximo passo atrasado ${d}d` })
    else if (d === 0) alertas.push({ tipo: 'passo', urg: 2, texto: 'Próximo passo é hoje' })
  }

  if (etapa === 'diagnostico') {
    const d = diasEntre(diag.data_reuniao)
    if (d > 30) alertas.push({ tipo: 'fp', urg: 2, texto: `Diagnóstico há ${d}d sem FP` })
  }

  if (etapa === 'implantacao') {
    if (combinados.length === 0)
      alertas.push({ tipo: 'combinados', urg: diasEntre(fp.completed_at) > 15 ? 2 : 1, texto: 'Cadastrar combinados do FP' })
    else if (diasEntre(fp.completed_at) > 30)
      alertas.push({ tipo: 'combinados', urg: 2, texto: `${pendentes.length} combinado(s) pendente(s)` })
  }

  if (diasSemContato != null && diasSemContato > diasContato)
    alertas.push({ tipo: 'contato', urg: 1, texto: `Sem contato há ${diasSemContato}d` })
  else if (diasSemContato == null)
    alertas.push({ tipo: 'contato', urg: 1, texto: 'Sem contato registrado' })

  alertas.sort((a, b) => b.urg - a.urg)

  return {
    ...contato,
    // O nome do export da XP vem cortado e em maiúsculas; o do diagnóstico é o completo.
    name: diag?.cliente_nome || nomeLegivel(contato.name),
    nomeXP: contato.name,
    perfil,
    naJornada: !!perfil?.na_jornada,
    tier,
    etapa,
    fp,
    cicloAberto,
    ciclos,
    diag,
    diags,
    combinados,
    pendentes,
    ultimoContato,
    diasSemContato,
    alertas,
    // "Hoje" mostra só o que é urgente de verdade; contato atrasado sozinho fica no card.
    pedeAcao: alertas.some(a => a.urg >= 2),
  }
}

const MINUSCULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e'])

/** "ANDRE DE FARIA R..." -> "Andre de Faria R..."; nomes já em caixa mista ficam como estão. */
export function nomeLegivel(nome) {
  if (!nome || nome !== nome.toUpperCase()) return nome
  return nome.toLowerCase().split(' ').map((p, i) =>
    i > 0 && MINUSCULAS.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)
  ).join(' ')
}

/** Próxima revisão a partir da data de entrega, pela cadência do tier. */
export function proximaRevisao(dataEntrega, tier, cadencia = CADENCIA_PADRAO) {
  const [, diasRevisao] = cadencia[tier || 'B'] || CADENCIA_PADRAO.B
  const d = parseDateOnly(dataEntrega) || new Date()
  d.setDate(d.getDate() + diasRevisao)
  return d.toISOString().slice(0, 10)
}

export function hojeISO() {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

export function rotuloDias(dias) {
  if (dias == null) return 'sem registro'
  if (dias === 0) return 'hoje'
  if (dias === 1) return 'ontem'
  return `há ${dias}d`
}

// ---------- escrita ----------

export async function setNaJornada(teamId, contactId, valor, userId) {
  const { error } = await supabase.from('client_profile')
    .upsert({ team_id: teamId, contact_id: contactId, na_jornada: valor, updated_by: userId }, { onConflict: 'contact_id' })
  if (error) throw error
}

export async function salvarPerfilJornada(teamId, contactId, valores, userId) {
  const { error } = await supabase.from('client_profile')
    .upsert({ team_id: teamId, contact_id: contactId, ...valores, updated_by: userId }, { onConflict: 'contact_id' })
  if (error) throw error
}

export async function vincularDiagnostico(diagId, contactId) {
  const { error } = await supabase.from('diagnosticos_360').update({ contact_id: contactId }).eq('id', diagId)
  if (error) throw error
}

export async function salvarCombinados(cicloId, combinados) {
  const { error } = await supabase.from('fp_cycles').update({ combinados }).eq('id', cicloId)
  if (error) throw error
}

/**
 * Sobe o PDF do FP gerado pela XP e marca o FP como entregue.
 * Usa o ciclo em aberto (reunião agendada, ainda sem entrega) se houver; senão cria um novo.
 */
export async function subirFP(teamId, cliente, arquivo, dataEntrega, cadencia, userId) {
  const nomeLimpo = arquivo.name.replace(/[^\w.\-]+/g, '_')
  const caminho = `${teamId}/fp/${cliente.id}/${Date.now()}_${nomeLimpo}`
  const { error: upErr } = await supabase.storage.from('pdfs').upload(caminho, arquivo, { contentType: 'application/pdf' })
  if (upErr) throw upErr

  const valores = {
    completed_at: dataEntrega,
    next_fp_date: proximaRevisao(dataEntrega, cliente.tier, cadencia),
    pdf_path: caminho,
    pdf_nome: arquivo.name,
  }
  let ciclo
  if (cliente.cicloAberto) {
    const { data, error } = await supabase.from('fp_cycles').update(valores).eq('id', cliente.cicloAberto.id).select().single()
    if (error) throw error
    ciclo = data
  } else {
    const { data, error } = await supabase.from('fp_cycles')
      .insert({ team_id: teamId, contact_id: cliente.id, created_by: userId, combinados: [], ...valores })
      .select().single()
    if (error) throw error
    ciclo = data
  }
  return ciclo
}

/**
 * Depois do upload: a função no servidor lê o PDF (sugere combinados) e copia o
 * arquivo para a pasta do cliente no Drive. Nada aqui é obrigatório: se falhar,
 * o FP continua registrado.
 */
export async function processarFP(teamId, cicloId) {
  const { data, error } = await supabase.functions.invoke('processar-fp', { body: { teamId, cicloId } })
  if (error) throw error
  return data
}

export async function abrirPDF(caminho) {
  const { data, error } = await supabase.storage.from('pdfs').createSignedUrl(caminho, 600)
  if (error) throw error
  window.open(data.signedUrl, '_blank', 'noopener')
}
