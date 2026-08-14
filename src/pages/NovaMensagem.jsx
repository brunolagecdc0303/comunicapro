import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../hooks/useAuth'
import { getContacts, getPDFs, uploadPDFsBulk, matchContactsPDFs, generateBulkMessages, extractClientCode } from '../lib/api'
import { supabase } from '../lib/supabase'
import { Send, Sparkles, Upload, FileText, CheckCircle, XCircle, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react'
import toast from 'react-hot-toast'

export default function NovaMensagem() {
  const { user, team } = useAuth()
  const [contacts, setContacts] = useState([])
  const [pdfs, setPdfs] = useState([])
  const [matched, setMatched] = useState([]) // { contact, pdf, matched }
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [aiPrompt, setAiPrompt] = useState('')
  const [generatedMessages, setGeneratedMessages] = useState([]) // { contact, pdf, message, status }
  const [sending, setSending] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState({ done: 0, total: 0 })
  const [genProgress, setGenProgress] = useState({ done: 0, total: 0 })
  const [sendProgress, setSendProgress] = useState({ done: 0, total: 0 })
  const [search, setSearch] = useState('')
  const [showGenerated, setShowGenerated] = useState(false)
  const pdfInputRef = useRef()

  useEffect(() => {
    if (team?.id) {
      Promise.all([getContacts(team.id), getPDFs(team.id)]).then(([c, p]) => {
        setContacts(c)
        setPdfs(p)
        setMatched(matchContactsPDFs(c, p))
      })
    }
  }, [team])

  // Recalcula matches quando PDFs mudam
  useEffect(() => {
    if (contacts.length > 0) {
      setMatched(matchContactsPDFs(contacts, pdfs))
    }
  }, [pdfs, contacts])

  const filteredMatched = matched.filter(m => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      m.contact.name?.toLowerCase().includes(q) ||
      m.contact.phone?.includes(q) ||
      m.contact.client_code?.includes(q)
    )
  })

  const selectedMatched = matched.filter(m => selectedIds.has(m.contact.id))
  const matchedCount = matched.filter(m => m.matched).length
  const selectedMatchedCount = selectedMatched.filter(m => m.matched).length

  // ==========================================
  // Upload PDFs em massa
  // ==========================================
  async function handlePDFUpload(e) {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return

    // Preview dos códigos que serão extraídos
    const preview = files.map(f => ({ name: f.name, code: extractClientCode(f.name) }))
    const withCode = preview.filter(p => p.code)
    const withoutCode = preview.filter(p => !p.code)

    if (withoutCode.length > 0) {
      const names = withoutCode.slice(0, 3).map(p => p.name).join(', ')
      const extra = withoutCode.length > 3 ? ` e mais ${withoutCode.length - 3}` : ''
      toast.error(`${withoutCode.length} arquivo(s) sem código detectável: ${names}${extra}`)
    }

    if (withCode.length === 0) {
      e.target.value = ''
      return
    }

    setUploading(true)
    setUploadProgress({ done: 0, total: files.length })

    try {
      const results = await uploadPDFsBulk(team.id, files, user.id, (done, total) => {
        setUploadProgress({ done, total })
      })

      const ok = results.filter(r => r.status === 'ok').length
      const fail = results.filter(r => r.status === 'error').length

      // Recarregar PDFs
      const newPdfs = await getPDFs(team.id)
      setPdfs(newPdfs)

      toast.success(`${ok} PDF(s) enviado(s)${fail > 0 ? `, ${fail} erro(s)` : ''}`)
    } catch (err) {
      toast.error('Erro no upload: ' + err.message)
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  // ==========================================
  // Selecionar contatos
  // ==========================================
  function toggleContact(id) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function selectAllMatched() {
    const matchedIds = filteredMatched.filter(m => m.matched).map(m => m.contact.id)
    setSelectedIds(new Set(matchedIds))
  }

  function selectAll() {
    setSelectedIds(new Set(filteredMatched.map(m => m.contact.id)))
  }

  function selectNone() {
    setSelectedIds(new Set())
  }

  // ==========================================
  // Gerar mensagens com IA
  // ==========================================
  async function handleGenerate() {
    if (!aiPrompt.trim()) {
      toast.error('Escreva uma instrução para a IA')
      return
    }
    if (selectedIds.size === 0) {
      toast.error('Selecione ao menos um contato')
      return
    }

    const contactsToGenerate = selectedMatched.map(m => ({
      contact: m.contact,
      pdf: m.pdf,
    }))

    setGenerating(true)
    setGenProgress({ done: 0, total: contactsToGenerate.length })
    setGeneratedMessages([])
    setShowGenerated(true)

    try {
      const results = await generateBulkMessages(
        aiPrompt,
        contactsToGenerate,
        team.id,
        (done, total) => setGenProgress({ done, total })
      )
      setGeneratedMessages(results)
      const ok = results.filter(r => r.status === 'generated').length
      toast.success(`${ok} mensagem(ns) gerada(s)`)
    } catch (err) {
      toast.error('Erro na geração: ' + err.message)
    } finally {
      setGenerating(false)
    }
  }

  // Editar uma mensagem gerada
  function updateGeneratedMessage(index, newMessage) {
    setGeneratedMessages(prev => {
      const next = [...prev]
      next[index] = { ...next[index], message: newMessage }
      return next
    })
  }

  // ==========================================
  // Enviar tudo (mensagem + PDF anexo)
  // ==========================================
  async function handleSendAll() {
    const toSend = generatedMessages.filter(m => m.status === 'generated' && m.message)
    if (toSend.length === 0) {
      toast.error('Nenhuma mensagem para enviar')
      return
    }

    setSending(true)
    setSendProgress({ done: 0, total: toSend.length })

    try {
      const messages = toSend.map(m => ({
        phone: m.contact.phone,
        content: m.message.replace('{{nome}}', m.contact.name),
        documentUrl: m.pdf?.file_url || null,
        fileName: m.pdf?.name || null,
      }))

      const { data, error } = await supabase.functions.invoke('send-messages', {
        body: { messages, teamId: team.id }
      })

      if (error) throw error

      const sent = data?.results?.filter(r => r.status === 'sent').length || messages.length
      toast.success(`${sent} mensagem(ns) enviada(s) com sucesso!`)
      setGeneratedMessages([])
      setSelectedIds(new Set())
      setAiPrompt('')
      setShowGenerated(false)
    } catch (err) {
      toast.error('Erro no envio: ' + (err.message || ''))
    } finally {
      setSending(false)
    }
  }

  return (
    <div>
      <h2 className="text-2xl font-display font-bold text-navy-500 mb-6">Nova Mensagem</h2>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Coluna esquerda: PDFs + Prompt + Ações */}
        <div className="space-y-4">
          {/* Upload PDFs em massa */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-display font-semibold text-navy-500 flex items-center gap-2">
                <FileText size={18} /> PDFs dos Clientes
              </h3>
              <span className="text-xs text-gray-400">
                {matchedCount}/{contacts.length} clientes com PDF
              </span>
            </div>

            <button
              onClick={() => pdfInputRef.current?.click()}
              disabled={uploading}
              className="btn-secondary w-full gap-1.5"
            >
              {uploading ? (
                <><div className="animate-spin w-4 h-4 border-2 border-navy-500 border-t-transparent rounded-full" /> Enviando {uploadProgress.done}/{uploadProgress.total}...</>
              ) : (
                <><Upload size={16} /> Importar PDFs em massa</>
              )}
            </button>
            <input
              ref={pdfInputRef}
              type="file"
              accept=".pdf"
              multiple
              onChange={handlePDFUpload}
              className="hidden"
            />
            <p className="text-xs text-gray-400">
              O código do cliente será extraído do nome do arquivo (ex: "Conta 355986.pdf" → código 355986)
            </p>
          </div>

          {/* Prompt IA */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-4">
            <h3 className="font-display font-semibold text-navy-500 flex items-center gap-2">
              <Sparkles size={18} /> Instrução para a IA
            </h3>

            <textarea
              value={aiPrompt}
              onChange={e => setAiPrompt(e.target.value)}
              placeholder={'Ex: Gere uma mensagem informando sobre a rentabilidade da carteira, usando os dados do PDF de cada cliente.\n\nUse {{nome}} para personalizar.'}
              className="input h-28 text-sm"
            />

            <div className="flex gap-2">
              <button
                onClick={handleGenerate}
                disabled={generating || !aiPrompt.trim() || selectedIds.size === 0}
                className="btn-primary flex-1 gap-1.5"
              >
                {generating ? (
                  <><div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" /> Gerando {genProgress.done}/{genProgress.total}...</>
                ) : (
                  <><Sparkles size={16} /> Gerar para {selectedIds.size} contato(s)</>
                )}
              </button>
            </div>

            {selectedIds.size > 0 && selectedMatchedCount < selectedIds.size && (
              <div className="flex items-start gap-2 bg-amber-50 text-amber-700 rounded-lg p-3 text-xs">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <span>
                  {selectedIds.size - selectedMatchedCount} contato(s) selecionado(s) não tem PDF associado.
                  A IA vai gerar sem contexto de documento para esses.
                </span>
              </div>
            )}
          </div>

          {/* Mensagens geradas — Preview e Envio */}
          {generatedMessages.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-3">
              <button
                onClick={() => setShowGenerated(!showGenerated)}
                className="flex items-center justify-between w-full"
              >
                <h3 className="font-display font-semibold text-navy-500">
                  Mensagens Geradas ({generatedMessages.filter(m => m.status === 'generated').length})
                </h3>
                {showGenerated ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
              </button>

              {showGenerated && (
                <div className="space-y-3 max-h-96 overflow-auto">
                  {generatedMessages.map((m, i) => (
                    <div key={i} className={`rounded-lg border p-3 text-sm ${m.status === 'error' ? 'border-red-200 bg-red-50' : 'border-gray-100'}`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-xs text-gray-700">
                          {m.contact.name}
                          {m.pdf && <span className="text-gray-400 ml-1">• PDF: {m.pdf.client_code}</span>}
                        </span>
                        {m.status === 'generated' ? (
                          <CheckCircle size={14} className="text-green-500" />
                        ) : (
                          <XCircle size={14} className="text-red-500" />
                        )}
                      </div>
                      {m.status === 'generated' ? (
                        <textarea
                          value={m.message}
                          onChange={e => updateGeneratedMessage(i, e.target.value)}
                          className="w-full border border-gray-200 rounded p-2 text-xs resize-none"
                          rows={3}
                        />
                      ) : (
                        <p className="text-xs text-red-600">{m.error}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={handleSendAll}
                disabled={sending || generatedMessages.filter(m => m.status === 'generated').length === 0}
                className="btn-primary w-full gap-1.5"
              >
                {sending ? (
                  <><div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" /> Enviando...</>
                ) : (
                  <><Send size={16} /> Enviar {generatedMessages.filter(m => m.status === 'generated').length} mensagem(ns) com PDF</>
                )}
              </button>
            </div>
          )}
        </div>

        {/* Coluna direita: Lista de contatos com match */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display font-semibold text-navy-500">Destinatários</h3>
            <div className="flex gap-1">
              <button onClick={selectAllMatched} className="text-xs text-accent-600 hover:underline">
                Com PDF
              </button>
              <span className="text-gray-300">|</span>
              <button onClick={selectAll} className="text-xs text-accent-600 hover:underline">
                Todos
              </button>
              <span className="text-gray-300">|</span>
              <button onClick={selectNone} className="text-xs text-gray-400 hover:underline">
                Nenhum
              </button>
            </div>
          </div>

          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nome, telefone ou código..."
            className="input mb-3 text-sm"
          />

          <div className="text-xs text-gray-400 mb-2">
            {selectedIds.size} selecionado(s) • {selectedMatchedCount} com PDF
          </div>

          <div className="max-h-[28rem] overflow-auto divide-y divide-gray-50 border border-gray-100 rounded-lg">
            {filteredMatched.map(({ contact, pdf, matched: hasMatch }) => {
              const isSelected = selectedIds.has(contact.id)
              return (
                <label
                  key={contact.id}
                  className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors ${
                    isSelected ? 'bg-accent-50' : 'hover:bg-gray-50'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleContact(contact.id)}
                    className="rounded"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{contact.name}</p>
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      <span className="font-mono">{contact.phone}</span>
                      {contact.client_code && (
                        <span className="text-navy-400">#{contact.client_code}</span>
                      )}
                    </div>
                  </div>
                  {hasMatch ? (
                    <span className="flex items-center gap-1 text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
                      <FileText size={10} /> PDF
                    </span>
                  ) : contact.client_code ? (
                    <span className="text-xs text-gray-300" title="Código presente, mas sem PDF correspondente">
                      sem PDF
                    </span>
                  ) : null}
                </label>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
