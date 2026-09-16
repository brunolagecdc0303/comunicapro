import { useState, useMemo } from 'react'
import { X, Search, Trash2, FileText, Sparkles, AlertTriangle, Link2, UserX } from 'lucide-react'
import toast from 'react-hot-toast'
import { deletePDFs, agruparPDFsPorCodigo, idsDuplicados, linkPDFToContact } from '../lib/api'
import { pdfsSemDono, contatosSemPdf } from '../lib/conferencia'

function tamanho(bytes) {
  if (!bytes) return ''
  const mb = bytes / 1048576
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`
}

function quando(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

/**
 * Biblioteca de PDFs: ver, limpar duplicados e excluir.
 *
 * Agrupado por código de cliente porque é assim que o problema aparece — o
 * mesmo cliente com três versões do relatório. O arquivo marcado "em uso" é o
 * que será anexado (sempre o mais recente); os outros são versões passadas.
 */
export default function PdfsModal({ pdfs, contacts = [], onClose, onChanged }) {
  const [selecionados, setSelecionados] = useState(new Set())
  const [busca, setBusca] = useState('')
  const [apagando, setApagando] = useState(false)
  const [aba, setAba] = useState('conferir')
  const [vinculando, setVinculando] = useState(null)

  const semDono = useMemo(() => pdfsSemDono(pdfs, contacts), [pdfs, contacts])
  const semPdf = useMemo(() => contatosSemPdf(pdfs, contacts), [pdfs, contacts])
  const grupos = useMemo(() => agruparPDFsPorCodigo(pdfs), [pdfs])
  const duplicados = useMemo(() => idsDuplicados(pdfs), [pdfs])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return grupos
    return grupos.filter(g =>
      g.codigo.toLowerCase().includes(q) ||
      g.emUso.name?.toLowerCase().includes(q))
  }, [grupos, busca])

  const espacoTotal = pdfs.reduce((s, p) => s + (p.file_size || 0), 0)
  const espacoDuplicado = pdfs
    .filter(p => duplicados.includes(p.id))
    .reduce((s, p) => s + (p.file_size || 0), 0)

  function alternar(id) {
    setSelecionados(prev => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  async function vincular(pdfId, contato) {
    setVinculando(pdfId)
    try {
      await linkPDFToContact(pdfId, contato.id)
      toast.success(`Associado a ${contato.name}`)
      await onChanged?.()
    } catch (err) {
      toast.error('Erro ao associar: ' + (err.message || ''))
    } finally {
      setVinculando(null)
    }
  }

  async function apagar(ids, rotulo) {
    if (!ids.length) return
    if (!confirm(`Excluir ${ids.length} arquivo(s)${rotulo ? ` (${rotulo})` : ''}?\n\nO arquivo sai do armazenamento e não tem como desfazer.`)) return

    setApagando(true)
    try {
      await deletePDFs(ids)
      toast.success(`${ids.length} PDF(s) excluído(s)`)
      setSelecionados(new Set())
      await onChanged?.()
    } catch (err) {
      toast.error('Erro ao excluir: ' + (err.message || ''))
    } finally {
      setApagando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className="relative bg-white rounded-2xl w-full max-w-3xl max-h-[88vh] flex flex-col shadow-xl">
        <header className="px-6 py-4 border-b border-gray-100 flex items-start justify-between gap-3">
          <div>
            <h3 className="font-display font-semibold text-navy-500">Biblioteca de PDFs</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              {pdfs.length} arquivo(s) · {tamanho(espacoTotal)} · {grupos.length} cliente(s)
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </header>

        {aba === 'arquivos' && duplicados.length > 0 && (
          <div className="mx-6 mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg
                          flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex gap-2 text-xs text-amber-800">
              <AlertTriangle size={15} className="shrink-0 mt-0.5" />
              <span>
                <strong>{duplicados.length} versão(ões) antiga(s)</strong> ocupando {tamanho(espacoDuplicado)}.
                Só a mais recente de cada cliente é anexada nas mensagens.
              </span>
            </div>
            <button onClick={() => apagar(duplicados, 'versões antigas')} disabled={apagando}
              className="btn-primary text-xs gap-1.5 shrink-0">
              <Sparkles size={14} /> Limpar duplicados
            </button>
          </div>
        )}

        <div className="px-6 pt-4 flex gap-1 border-b border-gray-100">
          {[['conferir', `Conferir${semDono.length ? ` (${semDono.length})` : ''}`],
            ['arquivos', `Arquivos (${pdfs.length})`]].map(([k, l]) => (
            <button key={k} onClick={() => setAba(k)}
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                aba === k ? 'border-accent-500 text-navy-500'
                          : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
              {l}
            </button>
          ))}
        </div>

        {aba === 'arquivos' && (
          <div className="px-6 pt-4">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={busca} onChange={e => setBusca(e.target.value)}
                placeholder="Buscar por código ou nome do arquivo..." className="input pl-9" />
            </div>
          </div>
        )}

        {aba === 'conferir' && (
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {semDono.length === 0 && semPdf.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-8">
                Tudo certo: todo PDF tem cliente e todo cliente com código tem PDF.
              </p>
            )}

            {semDono.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  PDFs que não estão indo para ninguém ({semDono.length})
                </h4>
                <p className="text-xs text-gray-400 mb-3">
                  O código no nome do arquivo não bate com nenhum cliente cadastrado.
                </p>
                <ul className="space-y-2">
                  {semDono.map(({ pdf, nomeNoArquivo, sugestao, candidatos, digitosDiferentes: dif }) => (
                    <li key={pdf.id} className="border border-amber-200 bg-amber-50/50 rounded-lg p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm text-gray-800 truncate">{pdf.name}</p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            código no arquivo: <span className="font-mono">{pdf.client_code}</span>
                            {nomeNoArquivo && <span> · nome: {nomeNoArquivo}</span>}
                          </p>
                        </div>
                        <button onClick={() => apagar([pdf.id])} disabled={apagando}
                          className="text-gray-300 hover:text-red-500 shrink-0" title="Excluir">
                          <Trash2 size={15} />
                        </button>
                      </div>

                      {sugestao ? (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span className="text-xs text-gray-600">
                            Parece ser <strong>{sugestao.name}</strong>
                            <span className="font-mono text-gray-400"> ({sugestao.client_code})</span>
                            {dif === 1 && <span className="text-amber-700"> · 1 dígito de diferença, provável erro de cadastro</span>}
                            {dif !== null && dif > 1 && <span className="text-gray-400"> · {dif} dígitos diferentes, pode ser outra conta</span>}
                          </span>
                          <button onClick={() => vincular(pdf.id, sugestao)} disabled={vinculando === pdf.id}
                            className="btn-secondary text-xs gap-1.5 py-1">
                            <Link2 size={13} /> {vinculando === pdf.id ? 'Associando...' : 'Associar'}
                          </button>
                        </div>
                      ) : (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span className="text-xs text-gray-500">
                            {candidatos.length > 1
                              ? `${candidatos.length} clientes com esse nome — escolha:`
                              : 'Nenhum cliente com esse nome. Associe manualmente:'}
                          </span>
                          <select defaultValue=""
                            onChange={e => {
                              const c = contacts.find(x => x.id === e.target.value)
                              if (c) vincular(pdf.id, c)
                            }}
                            className="text-xs border border-gray-200 rounded-lg px-2 py-1 outline-none
                                       focus:ring-2 focus:ring-accent-500 max-w-[16rem]">
                            <option value="" disabled>Escolher cliente...</option>
                            {(candidatos.length > 1 ? candidatos : contacts).map(c => (
                              <option key={c.id} value={c.id}>
                                {c.name}{c.client_code ? ` (${c.client_code})` : ''}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {semPdf.length > 0 && (
              <div className="pt-2">
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  Clientes sem PDF ({semPdf.length})
                </h4>
                <ul className="flex flex-wrap gap-2">
                  {semPdf.map(c => (
                    <li key={c.id}
                      className="flex items-center gap-1.5 text-xs bg-gray-50 border border-gray-100
                                 text-gray-600 px-2.5 py-1.5 rounded-lg">
                      <UserX size={12} className="text-gray-400" />
                      {c.name}
                      <span className="font-mono text-gray-400">{c.client_code}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {aba === 'arquivos' && (
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {filtrados.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-8">Nenhum PDF encontrado.</p>
          )}

          {filtrados.map(g => (
            <div key={g.codigo} className="border border-gray-100 rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-gray-50/70 border-b border-gray-100 flex items-center justify-between">
                <span className="text-xs font-mono font-medium text-navy-500">{g.codigo}</span>
                <span className="text-xs text-gray-400">
                  {g.total} arquivo(s){g.antigos.length > 0 && ` · ${g.antigos.length} antigo(s)`}
                </span>
              </div>

              <ul className="divide-y divide-gray-50">
                {[g.emUso, ...g.antigos].map((p, idx) => (
                  <li key={p.id} className={`flex items-center gap-3 px-3 py-2.5 ${
                    selecionados.has(p.id) ? 'bg-red-50/60' : ''}`}>
                    <input type="checkbox" checked={selecionados.has(p.id)}
                      onChange={() => alternar(p.id)} className="rounded" />
                    <FileText size={15} className={idx === 0 ? 'text-emerald-600 shrink-0' : 'text-gray-300 shrink-0'} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-800 truncate">{p.name}</p>
                      <p className="text-xs text-gray-400">
                        {quando(p.created_at)}{p.file_size ? ` · ${tamanho(p.file_size)}` : ''}
                      </p>
                    </div>
                    {idx === 0 ? (
                      <span className="text-xs bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded shrink-0">
                        em uso
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400 shrink-0">versão antiga</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        )}

        <footer className="px-6 py-4 border-t border-gray-100 flex items-center justify-between gap-3">
          <p className="text-xs text-gray-400">
            Arquivos com mais de 7 dias já são apagados sozinhos todo dia às 2h.
          </p>
          <div className="flex gap-2">
            {selecionados.size > 0 && (
              <button onClick={() => apagar([...selecionados])} disabled={apagando}
                className="btn-danger gap-1.5">
                <Trash2 size={15} /> {apagando ? 'Excluindo...' : `Excluir ${selecionados.size}`}
              </button>
            )}
            <button onClick={onClose} className="btn-secondary">Fechar</button>
          </div>
        </footer>
      </div>
    </div>
  )
}
