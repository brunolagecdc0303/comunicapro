import { useState, useEffect } from 'react'
import { X, Save, Trash2, ShieldAlert } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '../hooks/useAuth'
import { saveContact, deleteContacts, normalizePhone } from '../lib/api'
import { isValidCPF } from '../lib/privacy'
import { formatarTelefone } from '../lib/format'

const VAZIO = { name: '', phone: '', email: '', client_code: '', tags: '' }

export default function ContatoModal({ contato, onClose, onSaved }) {
  const { user, team } = useAuth()
  const [form, setForm] = useState(VAZIO)
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    setForm(contato?.id
      ? {
          name: contato.name || '',
          phone: contato.phone || '',
          email: contato.email || '',
          client_code: contato.client_code || '',
          tags: (contato.tags || []).join(', '),
        }
      : VAZIO)
  }, [contato])

  const set = (campo) => (e) => setForm(f => ({ ...f, [campo]: e.target.value }))
  const codigoEhCPF = isValidCPF(form.client_code)
  const telefoneNormalizado = normalizePhone(form.phone)

  async function salvar() {
    setSalvando(true)
    try {
      await saveContact(team.id, { ...form, id: contato?.id }, user.id)
      toast.success(contato?.id ? 'Contato atualizado' : 'Contato criado')
      onSaved?.()
      onClose()
    } catch (err) {
      toast.error(err.message || 'Erro ao salvar')
    } finally {
      setSalvando(false)
    }
  }

  async function excluir() {
    if (!contato?.id) return
    if (!confirm(`Excluir ${contato.name}?\n\nOs PDFs e o histórico de mensagens não são apagados.`)) return
    try {
      await deleteContacts([contato.id])
      toast.success('Contato excluído')
      onSaved?.()
      onClose()
    } catch {
      toast.error('Erro ao excluir')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className="relative bg-white rounded-2xl w-full max-w-lg shadow-xl flex flex-col max-h-[88vh]">
        <header className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-display font-semibold text-navy-500">
            {contato?.id ? 'Editar contato' : 'Novo contato'}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </header>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div>
            <label className="label">Nome *</label>
            <input value={form.name} onChange={set('name')} className="input"
              placeholder="Nome do cliente" />
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Telefone *</label>
              <input value={form.phone} onChange={set('phone')} className="input"
                placeholder="31999998888" />
              {telefoneNormalizado && (
                <p className="text-xs text-gray-400 mt-1">
                  Será salvo como <span className="font-mono">{formatarTelefone(telefoneNormalizado)}</span>
                </p>
              )}
            </div>
            <div>
              <label className="label">Código do cliente</label>
              <input value={form.client_code} onChange={set('client_code')} className="input font-mono"
                placeholder="355986" />
              <p className="text-xs text-gray-400 mt-1">É por ele que o PDF encontra o cliente.</p>
            </div>
          </div>

          {codigoEhCPF && (
            <div className="flex gap-2 p-3 bg-red-50 border border-red-100 rounded-lg text-xs text-red-700">
              <ShieldAlert size={15} className="shrink-0 mt-0.5" />
              <span>
                Isso é um CPF, não o código da conta. Documento de cliente não é guardado
                aqui — o salvamento será recusado.
              </span>
            </div>
          )}

          <div>
            <label className="label">Email</label>
            <input value={form.email} onChange={set('email')} className="input"
              placeholder="opcional" />
          </div>

          <div>
            <label className="label">Tags</label>
            <input value={form.tags} onChange={set('tags')} className="input"
              placeholder="vip, prospect (separadas por vírgula)" />
          </div>
        </div>

        <footer className="px-6 py-4 border-t border-gray-100 flex items-center justify-between gap-3">
          {contato?.id ? (
            <button onClick={excluir} className="btn-danger text-xs gap-1.5">
              <Trash2 size={14} /> Excluir
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-secondary">Cancelar</button>
            <button onClick={salvar} disabled={salvando || codigoEhCPF} className="btn-primary gap-1.5">
              <Save size={15} /> {salvando ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
