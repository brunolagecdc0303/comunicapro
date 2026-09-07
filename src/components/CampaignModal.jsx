import { useState, useEffect } from 'react'
import { getTemplates, getContacts, createCampaign, scheduleCampaign } from '../lib/api'
import { Clock } from 'lucide-react'
import toast from 'react-hot-toast'

// Modal de criação de campanha/envio, usado em Campanhas e Envios Programados.
// Permite enviar agora ou programar para uma data/hora, com intervalo entre mensagens.
export default function CampaignModal({ teamId, userId, onClose, onCreated }) {
  const [name, setName] = useState('')
  const [templates, setTemplates] = useState([])
  const [contacts, setContacts] = useState([])
  const [selectedTemplate, setSelectedTemplate] = useState('')
  const [selectedContacts, setSelectedContacts] = useState(new Set())
  const [customContent, setCustomContent] = useState('')
  const [scheduleDate, setScheduleDate] = useState('')
  const [scheduleTime, setScheduleTime] = useState('')
  const [delaySeconds, setDelaySeconds] = useState(5)
  const [sending, setSending] = useState(false)
  const [step, setStep] = useState(1)

  useEffect(() => {
    Promise.all([getTemplates(teamId), getContacts(teamId)])
      .then(([t, c]) => { setTemplates(t); setContacts(c) })
  }, [teamId])

  function handleTemplateChange(id) {
    setSelectedTemplate(id)
    const tpl = templates.find(t => t.id === id)
    if (tpl) setCustomContent(tpl.content)
  }

  function toggleContact(id) {
    const next = new Set(selectedContacts)
    next.has(id) ? next.delete(id) : next.add(id)
    setSelectedContacts(next)
  }

  function selectAll() {
    if (selectedContacts.size === contacts.length) setSelectedContacts(new Set())
    else setSelectedContacts(new Set(contacts.map(c => c.id)))
  }

  async function handleSend() {
    if (!name.trim() || !customContent.trim() || selectedContacts.size === 0) {
      toast.error('Preencha todos os campos e selecione destinatários')
      return
    }
    setSending(true)
    try {
      const campaign = await createCampaign({
        team_id: teamId,
        name: name.trim(),
        template_id: selectedTemplate || null,
        delay_seconds: delaySeconds,
        created_by: userId,
      })

      const recipients = contacts.filter(c => selectedContacts.has(c.id))
      let scheduledAt = null
      if (scheduleDate && scheduleTime) {
        scheduledAt = new Date(`${scheduleDate}T${scheduleTime}`).toISOString()
      }

      await scheduleCampaign(campaign.id, recipients, customContent, null, scheduledAt)
      toast.success(scheduledAt ? 'Envio programado!' : 'Campanha iniciada!')
      onCreated()
    } catch (err) {
      toast.error('Erro: ' + (err.message || ''))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-auto shadow-xl">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-display font-semibold text-navy-500">Novo Envio</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <div className="p-6 space-y-5">
          {/* Step indicators */}
          <div className="flex gap-2 mb-2">
            {[1, 2, 3].map(s => (
              <button
                key={s}
                onClick={() => setStep(s)}
                className={`flex-1 h-1 rounded-full transition-colors ${step >= s ? 'bg-accent-500' : 'bg-gray-200'}`}
              />
            ))}
          </div>

          {step === 1 && (
            <>
              <div>
                <label className="label">Nome da campanha</label>
                <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Convite Webinar Agosto" className="input" />
              </div>
              <div>
                <label className="label">Template (opcional)</label>
                <select value={selectedTemplate} onChange={e => handleTemplateChange(e.target.value)} className="input">
                  <option value="">Escrever do zero</option>
                  {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">
                  Mensagem <span className="text-gray-400 font-normal ml-1">{'{{nome}}'} = nome do contato</span>
                </label>
                <textarea value={customContent} onChange={e => setCustomContent(e.target.value)} className="input h-32" placeholder="Olá {{nome}}..." />
              </div>
              <button onClick={() => setStep(2)} disabled={!name.trim() || !customContent.trim()} className="btn-primary w-full">
                Próximo: Selecionar destinatários
              </button>
            </>
          )}

          {step === 2 && (
            <>
              <div className="flex items-center justify-between">
                <label className="label mb-0">Destinatários ({selectedContacts.size} de {contacts.length})</label>
                <button onClick={selectAll} className="text-xs text-accent-500 hover:text-accent-600 font-medium">
                  {selectedContacts.size === contacts.length ? 'Desmarcar todos' : 'Selecionar todos'}
                </button>
              </div>
              <div className="max-h-60 overflow-auto border border-gray-200 rounded-lg divide-y divide-gray-50">
                {contacts.map(c => (
                  <label key={c.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 cursor-pointer">
                    <input type="checkbox" checked={selectedContacts.has(c.id)} onChange={() => toggleContact(c.id)} className="rounded" />
                    <span className="text-sm font-medium">{c.name}</span>
                    <span className="text-xs text-gray-400 font-mono">{c.phone}</span>
                  </label>
                ))}
                {contacts.length === 0 && (
                  <p className="p-4 text-sm text-gray-400 text-center">Importe contatos primeiro</p>
                )}
              </div>
              <div className="flex gap-3">
                <button onClick={() => setStep(1)} className="btn-secondary flex-1">Voltar</button>
                <button onClick={() => setStep(3)} disabled={selectedContacts.size === 0} className="btn-primary flex-1">
                  Próximo: Agendar
                </button>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <div className="bg-blue-50 rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2 text-blue-700 font-medium text-sm">
                  <Clock size={16} />
                  Agendamento (opcional)
                </div>
                <p className="text-xs text-blue-600">Deixe vazio para enviar agora.</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Data</label>
                    <input type="date" value={scheduleDate} onChange={e => setScheduleDate(e.target.value)} className="input text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Horário</label>
                    <input type="time" value={scheduleTime} onChange={e => setScheduleTime(e.target.value)} className="input text-sm" />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Intervalo entre mensagens (segundos)</label>
                  <input
                    type="number"
                    min={2}
                    max={60}
                    value={delaySeconds}
                    onChange={e => setDelaySeconds(Number(e.target.value))}
                    className="input text-sm w-32"
                  />
                </div>
              </div>

              {/* Resumo */}
              <div className="bg-gray-50 rounded-xl p-4 text-sm space-y-2">
                <h4 className="font-display font-semibold text-navy-500">Resumo</h4>
                <p><span className="text-gray-500">Campanha:</span> {name}</p>
                <p><span className="text-gray-500">Destinatários:</span> {selectedContacts.size}</p>
                <p><span className="text-gray-500">Envio:</span> {scheduleDate && scheduleTime ? `${scheduleDate} às ${scheduleTime}` : 'Imediato'}</p>
                <p><span className="text-gray-500">Intervalo:</span> {delaySeconds}s entre mensagens</p>
                <div className="mt-2 p-3 bg-white rounded-lg border text-xs text-gray-600 whitespace-pre-wrap">
                  {customContent.slice(0, 200)}{customContent.length > 200 ? '...' : ''}
                </div>
              </div>

              <div className="flex gap-3">
                <button onClick={() => setStep(2)} className="btn-secondary flex-1">Voltar</button>
                <button onClick={handleSend} disabled={sending} className="btn-primary flex-1 gap-1.5">
                  {sending ? (
                    <><div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" /> Processando...</>
                  ) : scheduleDate ? (
                    <><Clock size={16} /> Agendar Envio</>
                  ) : (
                    <>Enviar Agora</>
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
