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
  // contacts = array de { name, phone, email, tags }
  const allRows = contacts.map(c => ({
    team_id: teamId,
    name: c.name?.trim(),
    phone: normalizePhone(c.phone),
    email: c.email?.trim() || null,
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

export async function scheduleCampaign(campaignId, contactIds, content, mediaUrl, scheduledAt) {
  // Criar mensagens na fila
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

  // Atualizar campanha
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

// ============================================
// PDFs
// ============================================
export async function uploadPDF(teamId, file, userId) {
  const path = `${teamId}/${Date.now()}_${file.name}`
  const { error: uploadError } = await supabase.storage
    .from('pdfs')
    .upload(path, file)
  if (uploadError) throw uploadError

  const { data: urlData } = supabase.storage
    .from('pdfs')
    .getPublicUrl(path)

  const { data, error } = await supabase
    .from('pdf_library')
    .insert({
      team_id: teamId,
      name: file.name,
      file_url: urlData.publicUrl,
      file_size: file.size,
      created_by: userId,
    })
    .select()
    .single()
  if (error) throw error
  return data
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
  // Adiciona 55 se não tem código do país
  if (clean.length === 11) clean = '55' + clean
  if (clean.length === 10) clean = '55' + clean
  return clean
}
