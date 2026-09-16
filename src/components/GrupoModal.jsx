import { useState, useEffect, useMemo } from 'react'
import { X, Search, Users, Building2, Star, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '../hooks/useAuth'
import { saveClientGroup, deleteClientGroup } from '../lib/api'
import { formatarTelefone } from '../lib/format'

/**
 * Cria/edita um grupo familiar ou empresarial.
 *
 * Dois papéis diferentes, e a distinção importa:
 *  - TITULAR: o telefone que recebe a mensagem.
 *  - MEMBROS: as contas cujos PDFs vão anexados.
 * Normalmente o titular também é membro, mas não obrigatoriamente — pode ser
 * um filho que cuida das contas dos pais sem ter conta própria.
 */
export default function GrupoModal({ grupo, contacts, onClose, onSaved }) {
  const { user, team } = useAuth()
  const [name, setName] = useState('')
  const [kind, setKind] = useState('familia')
  const [primaryId, setPrimaryId] = useState(null)
  const [memberIds, setMemberIds] = useState(new Set())
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setName(grupo?.name || '')
    setKind(grupo?.kind || 'familia')
    setPrimaryId(grupo?.primary_contact_id || null)
    setMemberIds(new Set(grupo?.memberIds || []))
    setSearch('')
  }, [grupo])

  const filtrados = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return contacts
    return contacts.filter(c =>
      c.name?.toLowerCase().includes(q) ||
      c.client_code?.includes(q) ||
      c.phone?.includes(q))
  }, [contacts, search])

  const selecionados = contacts.filter(c => memberIds.has(c.id))

  function toggleMember(id) {
    setMemberIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
        // Titular precisa continuar fazendo parte do grupo de alguma forma;
        // se ele sai da lista, deixa de ser titular também.
        if (primaryId === id) setPrimaryId(null)
      } else {
        next.add(id)
        if (!primaryId) setPrimaryId(id)  // o primeiro escolhido vira titular
      }
      return next
    })
  }

  async function handleSave() {
    if (!name.trim()) return toast.error('Dê um nome ao grupo')
    if (!primaryId) return toast.error('Escolha quem recebe a mensagem')
    if (memberIds.size === 0) return toast.error('Inclua ao menos uma conta')

    setSaving(true)
    try {
      await saveClientGroup(team.id, {
        id: grupo?.id,
        name: name.trim(),
        kind,
        primaryContactId: primaryId,
        memberIds: [...memberIds],
      }, user.id)
      toast.success(grupo?.id ? 'Grupo atualizado' : 'Grupo criado')
      onSaved?.()
      onClose()
    } catch (err) {
      toast.error('Erro ao salvar grupo: ' + (err.message || ''))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!grupo?.id) return
    if (!confirm(`Excluir o grupo "${grupo.name}"? Os contatos não são apagados.`)) return
    try {
      await deleteClientGroup(grupo.id)
      toast.success('Grupo excluído')
      onSaved?.()
      onClose()
    } catch {
      toast.error('Erro ao excluir')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className="relative bg-white rounded-2xl w-full max-w-3xl max-h-[88vh] flex flex-col shadow-xl">
        <header className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-display font-semibold text-navy-500">
            {grupo?.id ? 'Editar grupo' : 'Novo grupo'}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </header>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Nome do grupo</label>
              <input value={name} onChange={e => setName(e.target.value)}
                placeholder="Ex.: Família Ribeiro" className="input" />
            </div>
            <div>
              <label className="label">Tipo</label>
              <div className="flex gap-2">
                {[['familia', 'Familiar', Users], ['empresa', 'Empresarial', Building2]].map(([v, l, Icon]) => (
                  <button key={v} onClick={() => setKind(v)}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm border transition-colors ${
                      kind === v ? 'border-accent-500 bg-accent-50 text-navy-500' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
                    <Icon size={15} /> {l}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {selecionados.length > 0 && (
            <div className="bg-navy-50/60 rounded-lg p-3">
              <p className="text-xs font-medium text-navy-500 mb-2">
                Quem recebe a mensagem ({selecionados.length} conta(s) no grupo)
              </p>
              <div className="flex flex-wrap gap-2">
                {selecionados.map(c => (
                  <button key={c.id} onClick={() => setPrimaryId(c.id)}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs border transition-colors ${
                      primaryId === c.id
                        ? 'border-accent-500 bg-white text-navy-500 font-medium'
                        : 'border-transparent bg-white/70 text-gray-500 hover:border-gray-200'}`}>
                    <Star size={12} className={primaryId === c.id ? 'text-accent-500' : 'text-gray-300'} />
                    {c.name}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-2">
                Clique na estrela para escolher o titular. Os PDFs de todas as contas acima
                vão anexados nessa mesma conversa.
              </p>
            </div>
          )}

          <div>
            <label className="label">Contas que fazem parte</label>
            <div className="relative mb-2">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Buscar por nome, código ou telefone..." className="input pl-9" />
            </div>
            <div className="border border-gray-100 rounded-lg max-h-64 overflow-auto divide-y divide-gray-50">
              {filtrados.length === 0 ? (
                <p className="p-4 text-sm text-gray-400 text-center">Nenhum contato encontrado.</p>
              ) : filtrados.map(c => (
                <label key={c.id} className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer ${
                  memberIds.has(c.id) ? 'bg-accent-50/60' : 'hover:bg-gray-50'}`}>
                  <input type="checkbox" checked={memberIds.has(c.id)}
                    onChange={() => toggleMember(c.id)} className="rounded" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{c.name}</p>
                    <p className="text-xs text-gray-400">
                      {formatarTelefone(c.phone)}
                      {c.client_code && <span className="text-navy-400 ml-2">#{c.client_code}</span>}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          </div>
        </div>

        <footer className="px-6 py-4 border-t border-gray-100 flex items-center justify-between gap-3">
          {grupo?.id ? (
            <button onClick={handleDelete} className="btn-danger text-xs gap-1.5">
              <Trash2 size={14} /> Excluir grupo
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-secondary">Cancelar</button>
            <button onClick={handleSave} disabled={saving} className="btn-primary">
              {saving ? 'Salvando...' : 'Salvar grupo'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
