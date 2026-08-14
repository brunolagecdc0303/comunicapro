import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../hooks/useAuth'
import { getContacts, importContactsCSV, deleteContacts } from '../lib/api'
import { Upload, Search, Trash2, UserPlus, Download, Check } from 'lucide-react'
import Papa from 'papaparse'
import toast from 'react-hot-toast'

export default function Contatos() {
  const { user, team } = useAuth()
  const [contacts, setContacts] = useState([])
  const [filtered, setFiltered] = useState([])
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)
  const [csvPreview, setCsvPreview] = useState(null)
  const fileRef = useRef()

  useEffect(() => {
    if (team?.id) loadContacts()
  }, [team])

  useEffect(() => {
    if (!search.trim()) {
      setFiltered(contacts)
    } else {
      const q = search.toLowerCase()
      setFiltered(contacts.filter(c =>
        c.name?.toLowerCase().includes(q) ||
        c.phone?.includes(q) ||
        c.email?.toLowerCase().includes(q) ||
        c.client_code?.toLowerCase().includes(q) ||
        c.tags?.some(t => t.toLowerCase().includes(q))
      ))
    }
  }, [search, contacts])

  async function loadContacts() {
    setLoading(true)
    try {
      const data = await getContacts(team.id)
      setContacts(data)
    } catch (err) {
      toast.error('Erro ao carregar contatos')
    } finally {
      setLoading(false)
    }
  }

  function handleFileSelect(e) {
    const file = e.target.files?.[0]
    if (!file) return

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.data.length === 0) {
          toast.error('CSV vazio')
          return
        }
        const mapped = results.data.map(row => {
          const keys = Object.keys(row)
          const findCol = (...names) => {
            // Primeiro tenta match exato, depois substring
            const exact = keys.find(k => names.some(n => k.toLowerCase() === n))
            if (exact) return row[exact]
            const partial = keys.find(k => names.some(n => k.toLowerCase().includes(n)))
            return partial ? row[partial] : ''
          }
          return {
            client_code: findCol('codigo_cliente', 'client_code', 'codigo', 'código', 'conta', 'code'),
            name: findCol('nome', 'name'),
            phone: findCol('telefone', 'phone', 'celular', 'whatsapp', 'fone'),
            email: findCol('email', 'e-mail'),
            tags: findCol('tags', 'grupo', 'categoria', 'group'),
          }
        }).filter(r => r.phone)

        setCsvPreview(mapped)
        setShowImportModal(true)
      },
      error: () => toast.error('Erro ao ler CSV'),
    })
    e.target.value = ''
  }

  async function handleImport() {
    if (!csvPreview?.length) return
    setImporting(true)
    try {
      const imported = await importContactsCSV(team.id, csvPreview, user.id)
      toast.success(`${imported.length} contatos importados`)
      setShowImportModal(false)
      setCsvPreview(null)
      await loadContacts()
    } catch (err) {
      toast.error('Erro na importação: ' + (err.message || ''))
    } finally {
      setImporting(false)
    }
  }

  async function handleDelete() {
    if (selected.size === 0) return
    if (!confirm(`Excluir ${selected.size} contato(s)?`)) return
    try {
      await deleteContacts([...selected])
      toast.success(`${selected.size} contato(s) excluído(s)`)
      setSelected(new Set())
      await loadContacts()
    } catch {
      toast.error('Erro ao excluir')
    }
  }

  function toggleSelect(id) {
    const next = new Set(selected)
    next.has(id) ? next.delete(id) : next.add(id)
    setSelected(next)
  }

  function toggleAll() {
    if (selected.size === filtered.length) setSelected(new Set())
    else setSelected(new Set(filtered.map(c => c.id)))
  }

  function downloadTemplate() {
    const csv = 'nome,telefone,email,codigo_cliente,tags\nJoão Silva,31999998888,joao@email.com,355986,"cliente,vip"\nMaria Santos,31988887777,maria@email.com,412003,prospect'
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'modelo_contatos.csv'
    a.click()
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <h2 className="text-2xl font-display font-bold text-navy-500">Contatos</h2>
        <div className="flex gap-2">
          <button onClick={downloadTemplate} className="btn-secondary text-xs gap-1.5">
            <Download size={14} /> Modelo CSV
          </button>
          <button onClick={() => fileRef.current?.click()} className="btn-primary gap-1.5">
            <Upload size={16} /> Importar CSV
          </button>
          <input ref={fileRef} type="file" accept=".csv" onChange={handleFileSelect} className="hidden" />
        </div>
      </div>

      {/* Barra de busca e ações */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nome, telefone, email, código ou tag..."
            className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-accent-500 focus:border-transparent outline-none"
          />
        </div>
        {selected.size > 0 && (
          <button onClick={handleDelete} className="btn-danger gap-1.5">
            <Trash2 size={14} /> Excluir ({selected.size})
          </button>
        )}
      </div>

      {/* Tabela */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center">
            <div className="animate-spin w-6 h-6 border-2 border-navy-500 border-t-transparent rounded-full mx-auto" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-gray-400 text-sm">
            {contacts.length === 0
              ? 'Nenhum contato. Importe via CSV para começar.'
              : 'Nenhum resultado para essa busca.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-4 py-3 text-left w-10">
                    <input
                      type="checkbox"
                      checked={selected.size === filtered.length && filtered.length > 0}
                      onChange={toggleAll}
                      className="rounded"
                    />
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Nome</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Telefone</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500 hidden sm:table-cell">Código</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500 hidden md:table-cell">Email</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500 hidden lg:table-cell">Tags</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map(c => (
                  <tr key={c.id} className="hover:bg-gray-50/50">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(c.id)}
                        onChange={() => toggleSelect(c.id)}
                        className="rounded"
                      />
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900">{c.name}</td>
                    <td className="px-4 py-3 text-gray-600 font-mono text-xs">{c.phone}</td>
                    <td className="px-4 py-3 text-gray-600 font-mono text-xs hidden sm:table-cell">
                      {c.client_code || '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-600 hidden md:table-cell">{c.email || '—'}</td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <div className="flex gap-1 flex-wrap">
                        {c.tags?.map(t => (
                          <span key={t} className="px-2 py-0.5 bg-navy-50 text-navy-500 rounded text-xs">
                            {t}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="px-4 py-3 border-t border-gray-100 text-xs text-gray-400">
          {filtered.length} contato(s)
        </div>
      </div>

      {/* Modal Import Preview */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-xl">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-display font-semibold text-navy-500">
                Preview da Importação ({csvPreview?.length} contatos)
              </h3>
              <button onClick={() => { setShowImportModal(false); setCsvPreview(null) }} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Nome</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Telefone</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Código</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Email</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Tags</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {csvPreview?.slice(0, 50).map((r, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2">{r.name}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.phone}</td>
                      <td className="px-3 py-2 font-mono text-xs text-navy-500">{r.client_code || '—'}</td>
                      <td className="px-3 py-2 text-gray-500">{r.email || '—'}</td>
                      <td className="px-3 py-2 text-gray-500 text-xs">{r.tags || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {csvPreview?.length > 50 && (
                <p className="text-xs text-gray-400 mt-2 text-center">
                  Mostrando 50 de {csvPreview.length}
                </p>
              )}
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <button onClick={() => { setShowImportModal(false); setCsvPreview(null) }} className="btn-secondary">
                Cancelar
              </button>
              <button onClick={handleImport} disabled={importing} className="btn-primary gap-1.5">
                {importing ? (
                  <><div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" /> Importando...</>
                ) : (
                  <><Check size={16} /> Importar {csvPreview?.length} contatos</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
