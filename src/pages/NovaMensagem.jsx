import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'
import { getContacts, generateMessage, getPDFs } from '../lib/api'
import { supabase } from '../lib/supabase'
import { Send, Sparkles } from 'lucide-react'
import toast from 'react-hot-toast'

export default function NovaMensagem() {
  const { team } = useAuth()
  const [contacts, setContacts] = useState([])
  const [pdfs, setPdfs] = useState([])
  const [selectedContacts, setSelectedContacts] = useState([])
  const [message, setMessage] = useState('')
  const [aiPrompt, setAiPrompt] = useState('')
  const [selectedPdf, setSelectedPdf] = useState('')
  const [sending, setSending] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (team?.id) {
      getContacts(team.id).then(setContacts)
      getPDFs(team.id).then(setPdfs)
    }
  }, [team])

  const filtered = contacts.filter(c =>
    !search || c.name?.toLowerCase().includes(search.toLowerCase()) || c.phone?.includes(search)
  )

  async function handleGenerate() {
    if (!aiPrompt.trim()) return
    setGenerating(true)
    try {
      const msg = await generateMessage(aiPrompt, selectedPdf || null, team.id)
      setMessage(msg)
      toast.success('Mensagem gerada')
    } catch {
      toast.error('Erro ao gerar')
    } finally {
      setGenerating(false)
    }
  }

  async function handleSend() {
    if (!message.trim() || selectedContacts.length === 0) {
      toast.error('Escreva a mensagem e selecione ao menos um contato')
      return
    }
    setSending(true)
    try {
      // Envio direto via Edge Function
      const { error } = await supabase.functions.invoke('send-messages', {
        body: {
          messages: selectedContacts.map(c => ({
            phone: c.phone,
            content: message.replace('{{nome}}', c.name),
          })),
          teamId: team.id,
        }
      })
      if (error) throw error
      toast.success(`${selectedContacts.length} mensagem(ns) enviada(s)!`)
      setMessage('')
      setSelectedContacts([])
    } catch (err) {
      toast.error('Erro no envio: ' + (err.message || ''))
    } finally {
      setSending(false)
    }
  }

  function toggleContact(contact) {
    setSelectedContacts(prev =>
      prev.find(c => c.id === contact.id)
        ? prev.filter(c => c.id !== contact.id)
        : [...prev, contact]
    )
  }

  return (
    <div>
      <h2 className="text-2xl font-display font-bold text-navy-500 mb-6">Nova Mensagem</h2>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Coluna: Mensagem */}
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-4">
            <h3 className="font-display font-semibold text-navy-500">Mensagem</h3>

            {/* IA quick generate */}
            <div className="flex gap-2">
              <input
                type="text"
                value={aiPrompt}
                onChange={e => setAiPrompt(e.target.value)}
                placeholder="Descreva p/ IA gerar..."
                className="input flex-1 text-sm"
              />
              <select value={selectedPdf} onChange={e => setSelectedPdf(e.target.value)} className="input w-32 text-xs">
                <option value="">Sem PDF</option>
                {pdfs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <button onClick={handleGenerate} disabled={generating || !aiPrompt.trim()} className="btn-purple gap-1">
                <Sparkles size={14} /> {generating ? '...' : 'IA'}
              </button>
            </div>

            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder={'Olá {{nome}}, ...\n\nUse {{nome}} para personalizar.'}
              className="input h-40"
            />

            <div className="flex items-center justify-between text-xs text-gray-400">
              <span>{message.length} caracteres</span>
              <span>{selectedContacts.length} destinatário(s)</span>
            </div>

            <button
              onClick={handleSend}
              disabled={sending || !message.trim() || selectedContacts.length === 0}
              className="btn-primary w-full gap-1.5"
            >
              {sending ? (
                <><div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" /> Enviando...</>
              ) : (
                <><Send size={16} /> Enviar para {selectedContacts.length} contato(s)</>
              )}
            </button>
          </div>

          {/* Preview */}
          {message && selectedContacts.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <h4 className="text-xs font-medium text-gray-400 mb-2">Preview (primeiro contato)</h4>
              <div className="bg-green-50 rounded-lg p-3 text-sm whitespace-pre-wrap">
                {message.replace('{{nome}}', selectedContacts[0]?.name || 'Nome')}
              </div>
            </div>
          )}
        </div>

        {/* Coluna: Contatos */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h3 className="font-display font-semibold text-navy-500 mb-3">Destinatários</h3>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar contato..."
            className="input mb-3 text-sm"
          />
          <div className="max-h-96 overflow-auto divide-y divide-gray-50 border border-gray-100 rounded-lg">
            {filtered.map(c => {
              const isSelected = selectedContacts.some(s => s.id === c.id)
              return (
                <label key={c.id} className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors ${isSelected ? 'bg-accent-50' : 'hover:bg-gray-50'}`}>
                  <input type="checkbox" checked={isSelected} onChange={() => toggleContact(c)} className="rounded" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{c.name}</p>
                    <p className="text-xs text-gray-400 font-mono">{c.phone}</p>
                  </div>
                  {c.tags?.length > 0 && (
                    <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">{c.tags[0]}</span>
                  )}
                </label>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
