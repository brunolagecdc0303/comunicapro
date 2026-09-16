import { supabase } from './supabase'
import { extractClientCode } from './clientCode'

// Reexportado para não quebrar quem já importava daqui.
export { extractClientCode }

// ============================================
// CONTATOS
// ============================================
export async function getContacts(teamId) {
  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .eq('team_id', teamId)
    .order('name')
  if (error) throw error
  return data
}

export async function importContactsCSV(teamId, contacts, userId) {
  // contacts = array de { name, phone, email, tags, client_code }
  const allRows = contacts.map(c => ({
    team_id: teamId,
    name: c.name?.trim(),
    phone: normalizePhone(c.phone),
    email: c.email?.trim() || null,
    client_code: c.client_code?.toString().trim() || null,
    tags: c.tags ? (Array.isArray(c.tags) ? c.tags : c.tags.split(',').map(t => t.trim())) : [],
    created_by: userId,
  }))

  // Deduplicar por telefone (mantém o último registro de cada número)
  const uniqueMap = new Map()
  for (const row of allRows) {
    if (row.phone) uniqueMap.set(row.phone, row)
  }
  const rows = [...uniqueMap.values()]

  const { data, error } = await supabase
    .from('contacts')
    .upsert(rows, { onConflict: 'team_id,phone', ignoreDuplicates: false })
    .select()
  if (error) throw error
  return data
}

export async function deleteContacts(ids) {
  const { error } = await supabase
    .from('contacts')
    .delete()
    .in('id', ids)
  if (error) throw error
}

// ============================================
// GRUPOS
// ============================================
export async function getGroups(teamId) {
  const { data, error } = await supabase
    .from('contact_groups')
    .select('*, contact_group_members(contact_id)')
    .eq('team_id', teamId)
  if (error) throw error
  return data
}

export async function createGroup(teamId, name, contactIds, userId) {
  const { data: group, error } = await supabase
    .from('contact_groups')
    .insert({ team_id: teamId, name, created_by: userId })
    .select()
    .single()
  if (error) throw error

  if (contactIds?.length) {
    const members = contactIds.map(cid => ({ group_id: group.id, contact_id: cid }))
    await supabase.from('contact_group_members').insert(members)
  }
  return group
}

// ============================================
// TEMPLATES
// ============================================
export async function getTemplates(teamId) {
  const { data, error } = await supabase
    .from('message_templates')
    .select('*')
    .eq('team_id', teamId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function createTemplate(template) {
  const { data, error } = await supabase
    .from('message_templates')
    .insert(template)
    .select()
    .single()
  if (error) throw error
  return data
}

// ============================================
// CAMPANHAS
// ============================================
export async function getCampaigns(teamId) {
  const { data, error } = await supabase
    .from('campaigns')
    .select('*, message_templates(name, content)')
    .eq('team_id', teamId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function createCampaign(campaign) {
  const { data, error } = await supabase
    .from('campaigns')
    .insert(campaign)
    .select()
    .single()
  if (error) throw error
  return data
}

// Cancela um envio programado: mensagens ainda pendentes não são enviadas,
// as que já saíram permanecem como estavam. Valida no backend que o usuário
// pertence ao time da campanha.
export async function cancelCampaign(campaignId) {
  const { error } = await supabase.rpc('cancel_campaign', { p_campaign_id: campaignId })
  if (error) throw error
}

export async function scheduleCampaign(campaignId, contactIds, content, mediaUrl, scheduledAt) {
  const messages = contactIds.map(c => ({
    campaign_id: campaignId,
    contact_id: c.id,
    phone: c.phone,
    content: content.replace('{{nome}}', c.name),
    media_url: mediaUrl || null,
    status: 'pending',
    scheduled_at: scheduledAt || new Date().toISOString(),
  }))

  const { error: queueError } = await supabase
    .from('message_queue')
    .insert(messages)
  if (queueError) throw queueError

  const { error } = await supabase
    .from('campaigns')
    .update({
      status: scheduledAt ? 'scheduled' : 'running',
      scheduled_at: scheduledAt,
      total_recipients: contactIds.length,
    })
    .eq('id', campaignId)
  if (error) throw error
}

// ============================================
// IA - Gerar mensagem via Edge Function
// ============================================
export async function generateMessage(prompt, pdfId, teamId) {
  const { data, error } = await supabase.functions.invoke('generate-message', {
    body: { prompt, pdfId, teamId }
  })
  if (error) throw error
  return data.message
}

// Gerar mensagens em massa: uma por contato, usando o PDF correspondente
export async function generateBulkMessages(prompt, contactsWithPdfs, teamId, onProgress) {
  const results = []
  for (let i = 0; i < contactsWithPdfs.length; i++) {
    const { contact, pdf } = contactsWithPdfs[i]
    try {
      const personalPrompt = `${prompt}\n\nO destinatário é: ${contact.name} (código ${contact.client_code})`
      const { data, error } = await supabase.functions.invoke('generate-message', {
        body: { prompt: personalPrompt, pdfId: pdf?.id || null, teamId }
      })
      if (error) throw error
      results.push({
        contact,
        pdf,
        message: data.message,
        status: 'generated',
      })
    } catch (err) {
      results.push({
        contact,
        pdf,
        message: null,
        status: 'error',
        error: err.message,
      })
    }
    if (onProgress) onProgress(i + 1, contactsWithPdfs.length, results[results.length - 1])
  }
  return results
}

// ============================================
// PDFs
// ============================================
export async function uploadPDF(teamId, file, userId) {
  const clientCode = extractClientCode(file.name)
  const path = `${teamId}/${Date.now()}_${file.name}`
  const { error: uploadError } = await supabase.storage
    .from('pdfs')
    .upload(path, file)
  if (uploadError) throw uploadError

  // Bucket "pdfs" é privado (documentos de clientes) — guardamos o caminho,
  // não uma URL pública. O acesso é feito sob demanda com createSignedUrl.
  const { data, error } = await supabase
    .from('pdf_library')
    .insert({
      team_id: teamId,
      name: file.name,
      storage_path: path,
      file_size: file.size,
      client_code: clientCode,
      created_by: userId,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

// Gera uma URL temporária para acessar um PDF do bucket privado.
// Usada na hora de enviar o documento (ex.: pra Wasender buscar o arquivo).
export async function getPDFSignedUrl(storagePath, expiresInSeconds = 600) {
  const { data, error } = await supabase.storage
    .from('pdfs')
    .createSignedUrl(storagePath, expiresInSeconds)
  if (error) throw error
  return data.signedUrl
}

// Upload em massa de PDFs com extração de código do cliente
export async function uploadPDFsBulk(teamId, files, userId, onProgress) {
  const results = []
  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    try {
      const pdf = await uploadPDF(teamId, file, userId)
      results.push({ file: file.name, clientCode: pdf.client_code, status: 'ok', pdf })
    } catch (err) {
      results.push({ file: file.name, clientCode: extractClientCode(file.name), status: 'error', error: err.message })
    }
    if (onProgress) onProgress(i + 1, files.length)
  }
  return results
}

export async function getPDFs(teamId) {
  const { data, error } = await supabase
    .from('pdf_library')
    .select('*')
    .eq('team_id', teamId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

// ============================================
// DASHBOARD
// ============================================
export async function getDashboardStats(teamId) {
  const [contacts, campaigns, logs] = await Promise.all([
    supabase.from('contacts').select('id', { count: 'exact' }).eq('team_id', teamId),
    supabase.from('campaigns').select('*').eq('team_id', teamId).order('created_at', { ascending: false }).limit(5),
    supabase.from('message_log').select('id', { count: 'exact' }).eq('team_id', teamId),
  ])
  return {
    totalContacts: contacts.count || 0,
    recentCampaigns: campaigns.data || [],
    totalMessages: logs.count || 0,
  }
}

// ============================================
// UTILS
// ============================================
function normalizePhone(phone) {
  if (!phone) return ''
  let clean = phone.replace(/\D/g, '')
  if (clean.length === 11) clean = '55' + clean
  if (clean.length === 10) clean = '55' + clean
  return clean
}



// ============================================
// ACOMPANHAMENTO DE CLIENTES (FP + Produtos)
// ============================================
// Carrega as três fontes em paralelo e junta no cliente. São poucas centenas
// de linhas por time — não compensa criar view no banco (e uma view exigiria
// security_invoker pra não furar a RLS).
export async function getClientTracking(teamId) {
  const [contactsRes, productsRes, cyclesRes] = await Promise.all([
    supabase.from('contacts').select('id, name, phone, email, client_code, tags').eq('team_id', teamId).order('name'),
    supabase.from('client_products').select('*').eq('team_id', teamId),
    supabase.from('fp_cycles').select('*').eq('team_id', teamId).order('created_at', { ascending: false }),
  ])
  if (contactsRes.error) throw contactsRes.error
  if (productsRes.error) throw productsRes.error
  if (cyclesRes.error) throw cyclesRes.error

  const productsByContact = new Map(productsRes.data.map(p => [p.contact_id, p]))

  // cycles já vem ordenado do mais novo pro mais antigo; o primeiro de cada
  // contato é o ciclo atual, o resto é histórico.
  const cyclesByContact = new Map()
  for (const cycle of cyclesRes.data) {
    if (!cyclesByContact.has(cycle.contact_id)) cyclesByContact.set(cycle.contact_id, [])
    cyclesByContact.get(cycle.contact_id).push(cycle)
  }

  return contactsRes.data.map(contact => {
    const cycles = cyclesByContact.get(contact.id) || []
    return {
      ...contact,
      products: productsByContact.get(contact.id) || null,
      currentFP: cycles[0] || null,
      fpHistory: cycles,
    }
  })
}

export async function saveClientProducts(teamId, contactId, values, userId) {
  const { data, error } = await supabase
    .from('client_products')
    .upsert(
      { team_id: teamId, contact_id: contactId, ...values, updated_by: userId },
      { onConflict: 'contact_id' }
    )
    .select()
    .single()
  if (error) throw error
  return data
}

export async function createFPCycle(teamId, contactId, values, userId) {
  const { data, error } = await supabase
    .from('fp_cycles')
    .insert({ team_id: teamId, contact_id: contactId, ...values, created_by: userId })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateFPCycle(cycleId, values) {
  const { data, error } = await supabase
    .from('fp_cycles')
    .update(values)
    .eq('id', cycleId)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteFPCycle(cycleId) {
  const { error } = await supabase.from('fp_cycles').delete().eq('id', cycleId)
  if (error) throw error
}

// ============================================
// LEMBRETES DE FP
// ============================================
// Pré-visualização do que sairia hoje. A função no banco é sempre dry run e
// só devolve dados do time de quem chamou (checa membership por dentro).
export async function previewFPReminders(teamId) {
  const { data, error } = await supabase.rpc('preview_fp_reminders', { p_team_id: teamId })
  if (error) throw error
  return data || []
}

// Salva as configurações do time preservando as chaves que já existiam.
// Importante: settings é um jsonb único — sobrescrever o objeto inteiro
// apagaria silenciosamente as configurações de outra tela.
export async function saveTeamSettings(teamId, patch) {
  const { data: current, error: readError } = await supabase
    .from('teams')
    .select('settings')
    .eq('id', teamId)
    .single()
  if (readError) throw readError

  const merged = { ...(current?.settings || {}), ...patch }
  const { error } = await supabase.from('teams').update({ settings: merged }).eq('id', teamId)
  if (error) throw error
  return merged
}

// ============================================
// GRUPOS FAMILIARES / EMPRESARIAIS
// ============================================
export async function getClientGroups(teamId) {
  const { data, error } = await supabase
    .from('client_groups')
    .select('*, client_group_members(contact_id)')
    .eq('team_id', teamId)
    .order('name')
  if (error) throw error
  return (data || []).map(g => ({
    ...g,
    memberIds: (g.client_group_members || []).map(m => m.contact_id),
  }))
}

export async function saveClientGroup(teamId, { id, name, kind, primaryContactId, memberIds }, userId) {
  let groupId = id
  if (groupId) {
    const { error } = await supabase
      .from('client_groups')
      .update({ name, kind, primary_contact_id: primaryContactId })
      .eq('id', groupId)
    if (error) throw error
    // Substitui a composição inteira: mais simples e previsível que
    // calcular o diff de quem entrou e quem saiu.
    const { error: delError } = await supabase
      .from('client_group_members').delete().eq('group_id', groupId)
    if (delError) throw delError
  } else {
    const { data, error } = await supabase
      .from('client_groups')
      .insert({ team_id: teamId, name, kind, primary_contact_id: primaryContactId, created_by: userId })
      .select().single()
    if (error) throw error
    groupId = data.id
  }

  if (memberIds?.length) {
    const rows = memberIds.map(contact_id => ({ group_id: groupId, contact_id }))
    const { error } = await supabase.from('client_group_members').insert(rows)
    if (error) throw error
  }
  return groupId
}

export async function deleteClientGroup(groupId) {
  const { error } = await supabase.from('client_groups').delete().eq('id', groupId)
  if (error) throw error
}

// ============================================
// RASCUNHOS DE MENSAGEM
// ============================================
export async function getDrafts(teamId) {
  const { data, error } = await supabase
    .from('message_drafts')
    .select('*')
    .eq('team_id', teamId)
    .order('updated_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function saveDraft(teamId, { id, name, prompt, items }, userId) {
  if (id) {
    const { data, error } = await supabase
      .from('message_drafts')
      .update({ name, prompt, items })
      .eq('id', id).select().single()
    if (error) throw error
    return data
  }
  const { data, error } = await supabase
    .from('message_drafts')
    .insert({ team_id: teamId, name, prompt, items, created_by: userId })
    .select().single()
  if (error) throw error
  return data
}

export async function deleteDraft(draftId) {
  const { error } = await supabase.from('message_drafts').delete().eq('id', draftId)
  if (error) throw error
}

export async function markDraftSent(draftId) {
  const { error } = await supabase
    .from('message_drafts')
    .update({ sent_at: new Date().toISOString() })
    .eq('id', draftId)
  if (error) throw error
}

/** Substitui {{nome}} em TODAS as ocorrências (replace simples troca só a primeira). */
export function aplicarNome(texto, nome) {
  return String(texto ?? '').split('{{nome}}').join(nome ?? '')
}

// ============================================
// GERAÇÃO PARA DESTINATÁRIOS (contatos e grupos)
// ============================================
/**
 * Gera uma mensagem por destinatário.
 *
 * Contato individual: a IA recebe o PDF daquela conta e pode citar os números.
 *
 * Grupo: a IA gera SEM documento e, por instrução do system prompt, escreve um
 * texto genérico, sem números. É deliberado — a Edge Function lê um PDF por
 * chamada, e um texto citando a rentabilidade de uma conta só, mandado a quem
 * administra várias, seria informação errada para o cliente. Os PDFs de todas
 * as contas seguem anexados na mesma conversa.
 */
export async function gerarParaDestinatarios(prompt, destinatarios, teamId, onProgress) {
  const resultados = []

  for (let i = 0; i < destinatarios.length; i++) {
    const d = destinatarios[i]
    const ehGrupo = d.tipo === 'grupo'
    const pdfId = ehGrupo ? null : (d.pdfs[0]?.id || null)

    const contexto = ehGrupo
      ? `O destinatário é ${d.titular}, que administra ${d.contatos.length} contas: ` +
        d.contatos.map(c => `${c.name} (${c.client_code || 'sem código'})`).join(', ') +
        `. Escreva uma única mensagem para essa pessoa, sem citar números de rentabilidade, ` +
        `mencionando que os relatórios das contas seguem em anexo.`
      : `O destinatário é: ${d.nome}${d.clientCode ? ` (conta ${d.clientCode})` : ''}`

    try {
      const { data, error } = await supabase.functions.invoke('generate-message', {
        body: { prompt: `${prompt}\n\n${contexto}`, pdfId, teamId },
      })
      if (error) throw error
      resultados.push({ destinatarioId: d.id, message: data.message, status: 'gerada' })
    } catch (err) {
      resultados.push({ destinatarioId: d.id, message: '', status: 'erro', error: err.message })
    }
    onProgress?.(i + 1, destinatarios.length)
  }

  return resultados
}

// ============================================
// ENFILEIRAR (substitui o envio direto)
// ============================================
/**
 * Coloca as mensagens na message_queue e deixa o cron enviar.
 *
 * Por que não enviar direto da tela: o envio direto segura o navegador aberto
 * durante todo o disparo (minutos), morre se a aba fechar e não tem retry.
 * A fila já existe, roda de minuto em minuto, repete falha até 3x, registra
 * log e aparece em Envios Programados. `scheduledAt` nulo = enviar agora.
 *
 * O caminho do PDF vai como document_path: quem assina a URL é a Edge Function,
 * no instante do envio (ver migration 011).
 */
/**
 * Transforma destinatários nas linhas da message_queue. Pura de propósito:
 * é a parte que decide o que cada cliente recebe, e precisa ser testável.
 *
 * Sem PDF: uma linha de texto.
 * Com PDFs: o texto acompanha o primeiro documento e cada documento seguinte
 * vai numa linha curta identificando a conta.
 */
export function montarLinhasDaFila(destinatarios) {
  const linhas = []
  for (const d of destinatarios || []) {
    const texto = aplicarNome(d.message, d.name)
    const pdfs = d.pdfs || []

    if (pdfs.length === 0) {
      linhas.push({ phone: d.phone, content: texto, contact_id: d.contactId || null })
      continue
    }
    pdfs.forEach((pdf, i) => {
      linhas.push({
        phone: d.phone,
        content: i === 0 ? texto : `Conta ${pdf.client_code || pdf.name}`,
        contact_id: d.contactId || null,
        document_path: pdf.storage_path || null,
        document_name: pdf.name || null,
      })
    })
  }
  return linhas
}

export async function enfileirarMensagens(teamId, destinatarios, { nome, scheduledAt, delaySeconds } = {}) {
  const linhas = montarLinhasDaFila(destinatarios)
  if (linhas.length === 0) throw new Error('Nada para enfileirar')

  const { data: campanha, error: erroCampanha } = await supabase
    .from('campaigns')
    .insert({
      team_id: teamId,
      name: nome || `Envio de ${new Date().toLocaleDateString('pt-BR')}`,
      status: scheduledAt ? 'scheduled' : 'running',
      scheduled_at: scheduledAt || null,
      started_at: scheduledAt ? null : new Date().toISOString(),
      total_recipients: destinatarios.length,
      delay_seconds: delaySeconds ?? 5,
    })
    .select().single()
  if (erroCampanha) throw erroCampanha

  const quando = scheduledAt || new Date().toISOString()
  const { error } = await supabase.from('message_queue').insert(
    linhas.map(l => ({ ...l, campaign_id: campanha.id, status: 'pending', scheduled_at: quando }))
  )
  if (error) throw error

  return { campanhaId: campanha.id, mensagens: linhas.length }
}

// ============================================
// TEMPLATES DE INSTRUÇÃO
// ============================================
export async function getPromptTemplates(teamId) {
  const { data, error } = await supabase
    .from('message_templates')
    .select('id, name, content')
    .eq('team_id', teamId)
    .eq('kind', 'instrucao')
    .order('name')
  if (error) throw error
  return data || []
}

export async function savePromptTemplate(teamId, name, content, userId) {
  const { data, error } = await supabase
    .from('message_templates')
    .insert({ team_id: teamId, name, content, kind: 'instrucao', created_by: userId })
    .select().single()
  if (error) throw error
  return data
}

export async function deletePromptTemplate(id) {
  const { error } = await supabase.from('message_templates').delete().eq('id', id)
  if (error) throw error
}

// ============================================
// ÚLTIMO CONTATO POR CLIENTE
// ============================================
/** Mapa telefone -> { ultima, conteudo }, para avisar sobre disparos repetidos. */
export async function getUltimoContato(teamId) {
  const { data, error } = await supabase.rpc('ultimo_contato_por_telefone', { p_team_id: teamId })
  if (error) throw error
  const mapa = new Map()
  for (const r of data || []) mapa.set(r.phone, { ultima: r.ultima, conteudo: r.conteudo })
  return mapa
}

/** Dias desde o último contato, ou null se nunca houve. */
export function diasDesde(iso) {
  if (!iso) return null
  const ms = Date.now() - new Date(iso).getTime()
  return Math.floor(ms / 86400000)
}

// ============================================
// EXCLUSÃO DE PDFs
// ============================================
/**
 * Exclui PDFs: primeiro o arquivo no Storage, depois o registro.
 *
 * Nessa ordem de propósito. Se o registro saísse primeiro e o Storage falhasse,
 * o arquivo ficaria órfão no bucket: ninguém mais o vê no app, mas ele continua
 * ocupando espaço e guardando dado de cliente, sem nada que o encontre.
 * Falhando o Storage, o registro fica e dá para tentar de novo.
 */
export async function deletePDFs(ids) {
  if (!ids?.length) return { removidos: 0 }

  const { data: registros, error: erroBusca } = await supabase
    .from('pdf_library')
    .select('id, storage_path')
    .in('id', ids)
  if (erroBusca) throw erroBusca

  const caminhos = (registros || []).map(r => r.storage_path).filter(Boolean)
  if (caminhos.length > 0) {
    const { error } = await supabase.storage.from('pdfs').remove(caminhos)
    if (error) throw new Error(`Falha ao apagar arquivo no Storage: ${error.message}`)
  }

  const { error } = await supabase.from('pdf_library').delete().in('id', ids)
  if (error) throw error

  return { removidos: ids.length }
}

/**
 * Agrupa a biblioteca por código de cliente, do mais recente para o mais antigo.
 * O primeiro de cada grupo é o que o app anexa; os demais são versões antigas.
 */
export function agruparPDFsPorCodigo(pdfs) {
  const porCodigo = new Map()
  for (const pdf of pdfs || []) {
    const chave = pdf.client_code || '(sem código)'
    if (!porCodigo.has(chave)) porCodigo.set(chave, [])
    porCodigo.get(chave).push(pdf)
  }

  for (const lista of porCodigo.values()) {
    lista.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
  }

  return [...porCodigo.entries()]
    .map(([codigo, arquivos]) => ({
      codigo,
      emUso: arquivos[0],
      antigos: arquivos.slice(1),
      total: arquivos.length,
    }))
    .sort((a, b) => b.antigos.length - a.antigos.length || a.codigo.localeCompare(b.codigo))
}

/** Ids de todas as versões antigas — o que "limpar duplicados" remove. */
export function idsDuplicados(pdfs) {
  return agruparPDFsPorCodigo(pdfs).flatMap(g => g.antigos.map(p => p.id))
}

/** Vincula um PDF a um contato (ou desfaz, com contactId null). */
export async function linkPDFToContact(pdfId, contactId) {
  const { error } = await supabase
    .from('pdf_library')
    .update({ contact_id: contactId })
    .eq('id', pdfId)
  if (error) throw error
}
