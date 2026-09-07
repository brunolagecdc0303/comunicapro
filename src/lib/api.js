import { supabase } from './supabase'

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

// Extrai código do cliente do nome do arquivo
// Ex: "Conta 355986.pdf" → "355986", "355986_relatorio.pdf" → "355986"
export function extractClientCode(filename) {
  if (!filename) return null
  // Remove extensão
  const name = filename.replace(/\.[^.]+$/, '')
  // Procura sequência de 4+ dígitos
  const match = name.match(/(\d{4,})/)
  return match ? match[1] : null
}
