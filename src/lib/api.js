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

// Busca PDFs que fazem match com contatos pelo client_code
export function matchContactsPDFs(contacts, pdfs) {
  const pdfMap = new Map()
  for (const pdf of pdfs) {
    if (pdf.client_code) pdfMap.set(pdf.client_code, pdf)
  }
  return contacts.map(contact => ({
    contact,
    pdf: contact.client_code ? pdfMap.get(contact.client_code) || null : null,
    matched: contact.client_code ? pdfMap.has(contact.client_code) : false,
  }))
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

// ============================================
// ENVIO EM LOTES
// ============================================
// A Edge Function dorme `delay` segundos entre mensagens, e o worker do
// Supabase é morto aos 150s (plano free). Mandar 38 destinatários de uma vez
// com delay de 5s daria ~190s: o envio morria no meio, sem dizer quais saíram.
// Por isso o envio é fatiado em lotes que cabem com folga na janela.
const JANELA_SEGURA_S = 110

export function tamanhoDoLote(delaySeconds = 5) {
  // +1s por mensagem como estimativa da chamada à Wasender.
  const porMensagem = Math.max(1, delaySeconds) + 1
  return Math.max(3, Math.floor(JANELA_SEGURA_S / porMensagem))
}

/** Substitui {{nome}} em TODAS as ocorrências (replace simples troca só a primeira). */
export function aplicarNome(texto, nome) {
  return String(texto ?? '').split('{{nome}}').join(nome ?? '')
}

/**
 * Monta as mensagens de um destinatário.
 * Sem PDF: uma mensagem de texto.
 * Com PDFs (caso dos grupos): o texto vai junto do primeiro documento e cada
 * documento seguinte vai numa mensagem curta identificando a conta — é assim
 * que chega legível no WhatsApp.
 */
export async function montarMensagens(destinatario) {
  const texto = aplicarNome(destinatario.message, destinatario.name)
  const pdfs = destinatario.pdfs || []

  if (pdfs.length === 0) {
    return [{ phone: destinatario.phone, content: texto }]
  }

  const mensagens = []
  for (let i = 0; i < pdfs.length; i++) {
    const pdf = pdfs[i]
    // URL assinada gerada na hora do lote: o bucket é privado e o link é curto.
    const documentUrl = pdf.storage_path ? await getPDFSignedUrl(pdf.storage_path) : null
    mensagens.push({
      phone: destinatario.phone,
      content: i === 0 ? texto : `Conta ${pdf.client_code || pdf.name}`,
      documentUrl,
      fileName: pdf.name || null,
    })
  }
  return mensagens
}

/**
 * Envia em lotes. onProgress(enviadas, total, rotuloDoLote) a cada lote.
 * Devolve { enviadas, falhas, erros[] } — parcial se algum lote falhar, para
 * o usuário saber exatamente onde parou em vez de "deu erro".
 */
export async function enviarEmLotes(teamId, destinatarios, delaySeconds, onProgress) {
  const todas = []
  for (const d of destinatarios) {
    todas.push(...await montarMensagens(d))
  }

  const lote = tamanhoDoLote(delaySeconds)
  let enviadas = 0
  let falhas = 0
  const erros = []

  for (let i = 0; i < todas.length; i += lote) {
    const fatia = todas.slice(i, i + lote)
    try {
      const { data, error } = await supabase.functions.invoke('send-messages', {
        body: { messages: fatia, teamId },
      })
      if (error) throw error
      const ok = data?.results?.filter(r => r.status === 'sent').length ?? fatia.length
      enviadas += ok
      falhas += fatia.length - ok
    } catch (err) {
      falhas += fatia.length
      erros.push(`Lote ${Math.floor(i / lote) + 1}: ${err.message || err}`)
    }
    onProgress?.(enviadas + falhas, todas.length)
  }

  return { enviadas, falhas, erros, total: todas.length }
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
