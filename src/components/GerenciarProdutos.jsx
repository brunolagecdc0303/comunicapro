import { useState } from 'react'
import { X, Plus, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '../hooks/useAuth'
import { createProdutoPersonalizado, deleteProdutoPersonalizado } from '../lib/api'
import { PRODUCTS, chaveDoProduto } from '../lib/tracking'

/**
 * Cria e remove as colunas de produto do próprio time.
 * O catálogo fixo aparece só para referência — ele muda por código.
 */
export default function GerenciarProdutos({ personalizados, onClose, onChanged }) {
  const { user, team } = useAuth()
  const [nome, setNome] = useState('')
  const [abreviacao, setAbreviacao] = useState('')
  const [pergunta, setPergunta] = useState('')
  const [saving, setSaving] = useState(false)

  const chave = chaveDoProduto(nome)
  const nomesExistentes = new Set(
    [...PRODUCTS.map(p => p.label), ...personalizados.map(p => p.nome)].map(n => n.trim().toLowerCase())
  )
  const duplicado = nomesExistentes.has(nome.trim().toLowerCase())
    || personalizados.some(p => p.chave === chave)

  async function criar(e) {
    e.preventDefault()
    if (!chave || duplicado) return
    setSaving(true)
    try {
      await createProdutoPersonalizado(team.id, {
        chave,
        nome: nome.trim(),
        abreviacao: abreviacao.trim() || null,
        pergunta_detalhe: pergunta.trim() || null,
        ordem: personalizados.length,
      }, user.id)
      toast.success(`Coluna "${nome.trim()}" criada`)
      setNome(''); setAbreviacao(''); setPergunta('')
      onChanged?.()
    } catch (err) {
      toast.error('Erro ao criar produto: ' + (err.message || ''))
    } finally {
      setSaving(false)
    }
  }

  async function remover(p) {
    if (!confirm(`Remover a coluna "${p.nome}"? Os estágios já marcados ficam guardados e voltam se você recriar um produto com o mesmo nome.`)) return
    try {
      await deleteProdutoPersonalizado(p.id)
      toast.success('Coluna removida')
      onChanged?.()
    } catch (err) {
      toast.error('Erro ao remover: ' + (err.message || ''))
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className="relative bg-white w-full max-w-md max-h-full rounded-xl shadow-xl flex flex-col">
        <header className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-display font-semibold text-navy-500">Colunas de produto</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </header>

        <div className="overflow-y-auto p-6 space-y-5">
          <form onSubmit={criar} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Nome do produto</label>
              <input value={nome} onChange={e => setNome(e.target.value)} autoFocus
                placeholder="Ex.: Previdência VGBL" className="input" maxLength={60} />
              {nome.trim() && duplicado && (
                <p className="text-xs text-red-600 mt-1">Já existe um produto com esse nome.</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Título curto (opcional)</label>
                <input value={abreviacao} onChange={e => setAbreviacao(e.target.value)}
                  placeholder="Ex.: VGBL" className="input" maxLength={20} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Complemento (opcional)</label>
                <input value={pergunta} onChange={e => setPergunta(e.target.value)}
                  placeholder="Ex.: Qual seguradora?" className="input" maxLength={60} />
              </div>
            </div>
            <button type="submit" disabled={saving || !chave || duplicado} className="btn-primary gap-1.5">
              <Plus size={15} /> {saving ? 'Criando...' : 'Criar coluna'}
            </button>
          </form>

          <div className="pt-4 border-t border-gray-100">
            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
              Criados pelo time ({personalizados.length})
            </h4>
            {personalizados.length === 0 ? (
              <p className="text-xs text-gray-400">Nenhum ainda.</p>
            ) : (
              <ul className="space-y-1.5">
                {personalizados.map(p => (
                  <li key={p.id} className="flex items-center justify-between gap-2 bg-gray-50 rounded-lg px-3 py-2 text-sm">
                    <span className="text-gray-800">
                      {p.nome}
                      {p.abreviacao && <span className="text-gray-400"> · {p.abreviacao}</span>}
                      {p.pergunta_detalhe && <span className="text-gray-400 text-xs"> · {p.pergunta_detalhe}</span>}
                    </span>
                    <button onClick={() => remover(p)} title="Remover coluna"
                      className="text-gray-400 hover:text-red-600 shrink-0">
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Catálogo padrão</h4>
            <p className="text-xs text-gray-400">{PRODUCTS.map(p => p.label).join(' · ')}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
