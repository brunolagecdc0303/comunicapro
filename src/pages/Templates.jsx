import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../hooks/useAuth'
import { getTemplates, createTemplate, generateMessage, getPDFs, uploadPDF } from '../lib/api'
import { Plus, Sparkles, FileText, Upload, Copy } from 'lucide-react'
import toast from 'react-hot-toast'

export default function Templates() {
  const { user, team } = useAuth()
  const [templates, setTemplates] = useState([])
  const [pdfs, setPdfs] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)

  useEffect(() => {
    if (team?.id) {
      Promise.all([getTemplates(team.id), getPDFs(team.id)])
        .then(([t, p]) => { setTemplates(t); setPdfs(p) })
        .finally(() => setLoading(false))
    }
  }, [team])

  async function handleSave(template) {
    try {
      const saved = await createTemplate({ ...template, team_id: team.id, created_by: user.id })
      setTemplates(prev => [saved, ...prev])
      setShowCreate(false)
      toast.success('Template salvo')
    } catch {
      toast.error('Erro ao salvar template')
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-display font-bold text-navy-500">Templates</h2>
        <button onClick={() => setShowCreate(true)} className="btn-primary gap-1.5">
          <Plus size={16} /> Novo Template
        </button>
      </div>

      {loading ? (
        <div className="p-12 text-center">
          <div className="animate-spin w-6 h-6 border-2 border-navy-500 border-t-transparent rounded-full mx-auto" />
        </div>
      ) : templates.length === 0 ? (
        <EmptyState onAdd={() => setShowCreate(true)} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {templates.map(t => (
            <TemplateCard key={t.id} template={t} />
          ))}
        </div>
      )}

      {showCreate && (
        <CreateTemplateModal
          pdfs={pdfs}
          teamId={team.id}
          userId={user.id}
          onSave={handleSave}
          onClose={() => setShowCreate(false)}
          onPdfUpload={async (file) => {
            const pdf = await uploadPDF(team.id, file, user.id)
            setPdfs(prev => [pdf, ...prev])
            return pdf
          }}
        />
      )}
    </div>
  )
}

function TemplateCard({ template }) {
  function copyContent() {
    navigator.clipboard.writeText(template.content)
    toast.success('Copiado!')
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-display font-semibold text-navy-500">{template.name}</h3>
          {template.ai_generated && (
            <span className="inline-flex items-center gap-1 text-xs text-purple-600 bg-purple-50 px-2 py-0.5 rounded mt-1">
              <Sparkles size={10} /> Gerado por IA
            </span>
          )}
        </div>
        <button onClick={copyContent} className="text-gray-400 hover:text-gray-600 p-1">
          <Copy size={16} />
        </button>
      </div>
      <p className="text-sm text-gray-600 whitespace-pre-wrap line-clamp-4">{template.content}</p>
      {template.media_url && (
        <div className="mt-3 flex items-center gap-2 text-xs text-gray-400">
          <FileText size={12} />
          <span>Anexo incluído</span>
        </div>
      )}
    </div>
  )
}

function CreateTemplateModal({ pdfs, teamId, userId, onSave, onClose, onPdfUpload }) {
  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [aiPrompt, setAiPrompt] = useState('')
  const [selectedPdf, setSelectedPdf] = useState('')
  const [generating, setGenerating] = useState(false)
  const [uploading, setUploading] = useState(false)
  const pdfInputRef = useRef()

  async function handleGenerate() {
    if (!aiPrompt.trim()) return
    setGenerating(true)
    try {
      const msg = await generateMessage(aiPrompt, selectedPdf || null, teamId)
      setContent(msg)
      toast.success('Mensagem gerada pela IA')
    } catch {
      toast.error('Erro ao gerar mensagem')
    } finally {
      setGenerating(false)
    }
  }

  async function handlePdfUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const pdf = await onPdfUpload(file)
      setSelectedPdf(pdf.id)
      toast.success('PDF enviado')
    } catch {
      toast.error('Erro no upload')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  function handleSave() {
    if (!name.trim() || !content.trim()) {
      toast.error('Preencha nome e conteúdo')
      return
    }
    onSave({
      name: name.trim(),
      content: content.trim(),
      ai_generated: !!aiPrompt,
      ai_prompt: aiPrompt || null,
    })
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-xl max-h-[90vh] overflow-auto shadow-xl">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-display font-semibold text-navy-500">Novo Template</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <div className="p-6 space-y-5">
          {/* Nome */}
          <div>
            <label className="label">Nome do template</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Ex: Boas vindas novo cliente"
              className="input"
            />
          </div>

          {/* IA Generator */}
          <div className="bg-purple-50 rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2 text-purple-700 font-medium text-sm">
              <Sparkles size={16} />
              Gerar com IA
            </div>

            {/* PDF select */}
            <div className="flex gap-2">
              <select
                value={selectedPdf}
                onChange={e => setSelectedPdf(e.target.value)}
                className="input flex-1 text-sm"
              >
                <option value="">Sem PDF de referência</option>
                {pdfs.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <button
                onClick={() => pdfInputRef.current?.click()}
                disabled={uploading}
                className="btn-secondary text-xs gap-1"
              >
                <Upload size={12} /> {uploading ? '...' : 'PDF'}
              </button>
              <input ref={pdfInputRef} type="file" accept=".pdf" onChange={handlePdfUpload} className="hidden" />
            </div>

            <textarea
              value={aiPrompt}
              onChange={e => setAiPrompt(e.target.value)}
              placeholder="Descreva a mensagem que deseja. Ex: Mensagem convidando clientes para webinar sobre renda fixa, tom profissional mas acessível, mencionar dados do PDF anexo..."
              className="input h-20 text-sm"
            />
            <button
              onClick={handleGenerate}
              disabled={generating || !aiPrompt.trim()}
              className="w-full py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {generating ? (
                <><div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" /> Gerando...</>
              ) : (
                <><Sparkles size={14} /> Gerar Mensagem</>
              )}
            </button>
          </div>

          {/* Content */}
          <div>
            <label className="label">
              Conteúdo da mensagem
              <span className="text-gray-400 font-normal ml-2">Use {'{{nome}}'} para personalizar</span>
            </label>
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="Olá {{nome}}, tudo bem? ..."
              className="input h-32"
            />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onClose} className="btn-secondary">Cancelar</button>
          <button onClick={handleSave} className="btn-primary">Salvar Template</button>
        </div>
      </div>
    </div>
  )
}

function EmptyState({ onAdd }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
      <FileText className="mx-auto text-gray-300 mb-3" size={40} />
      <p className="text-gray-500 text-sm mb-4">Nenhum template ainda. Crie modelos de mensagem para reutilizar nas campanhas.</p>
      <button onClick={onAdd} className="btn-primary gap-1.5">
        <Plus size={16} /> Criar primeiro template
      </button>
    </div>
  )
}
