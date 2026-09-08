import { useState, useEffect } from 'react'
import { X, Plus, Trash2, Save, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '../hooks/useAuth'
import { saveClientProducts, createFPCycle, updateFPCycle, deleteFPCycle } from '../lib/api'
import { PRODUCTS, formatDate, combinadosToText, textToCombinados } from '../lib/tracking'
import { containsCPF, redactCPFs } from '../lib/privacy'

const EMPTY_CYCLE = {
  meeting_scheduled_at: '',
  completed_at: '',
  in_execution: false,
  next_fp_date: '',
  combinados: [],
  notes: '',
}

/**
 * Painel lateral de edição de um cliente.
 * A grade cobre a leitura rápida; aqui é onde se cadastra um FP novo e se
 * marca produto por produto, com espaço para os campos "qual seguradora/
 * corretora/consorciadora".
 */
export default function ClientDrawer({ client, tab, onClose, onSaved }) {
  const { user, team } = useAuth()
  const [active, setActive] = useState(tab === 'produtos' ? 'produtos' : 'fp')
  const [saving, setSaving] = useState(false)

  const [products, setProducts] = useState({})
  const [cycle, setCycle] = useState(EMPTY_CYCLE)
  const [cycleId, setCycleId] = useState(null)
  const [combinadosText, setCombinadosText] = useState('')

  useEffect(() => {
    setProducts(client?.products || {})
    loadCycle(client?.currentFP || null)
    setActive(tab === 'produtos' ? 'produtos' : 'fp')
  }, [client?.id, tab])

  function loadCycle(source) {
    setCycleId(source?.id || null)
    setCycle({
      meeting_scheduled_at: source?.meeting_scheduled_at || '',
      completed_at: source?.completed_at || '',
      in_execution: !!source?.in_execution,
      next_fp_date: source?.next_fp_date || '',
      combinados: source?.combinados || [],
      notes: source?.notes || '',
    })
    setCombinadosText(combinadosToText(source?.combinados))
  }

  const freeTextHasCPF = containsCPF(combinadosText) || containsCPF(cycle.notes)

  async function handleSaveFP() {
    setSaving(true)
    try {
      // Rede de segurança: mesmo se o aviso na tela for ignorado, o CPF não sobe.
      const payload = {
        meeting_scheduled_at: cycle.meeting_scheduled_at || null,
        completed_at: cycle.completed_at || null,
        in_execution: cycle.in_execution,
        next_fp_date: cycle.next_fp_date || null,
        combinados: textToCombinados(redactCPFs(combinadosText), cycle.combinados),
        notes: redactCPFs(cycle.notes) || null,
      }
      if (cycleId) await updateFPCycle(cycleId, payload)
      else await createFPCycle(team.id, client.id, payload, user.id)

      toast.success(freeTextHasCPF ? 'FP salvo (CPF removido do texto)' : 'FP salvo')
      onSaved?.()
    } catch (err) {
      toast.error('Erro ao salvar FP: ' + (err.message || ''))
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveProducts() {
    setSaving(true)
    try {
      const payload = {}
      for (const p of PRODUCTS) {
        payload[p.field] = !!products[p.field]
        if (p.detail) {
          // Se desmarcou o produto, o detalhe deixa de fazer sentido.
          payload[p.detail.field] = products[p.field]
            ? (products[p.detail.field]?.trim() || null)
            : null
        }
      }
      await saveClientProducts(team.id, client.id, payload, user.id)
      toast.success('Produtos salvos')
      onSaved?.()
    } catch (err) {
      toast.error('Erro ao salvar produtos: ' + (err.message || ''))
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteCycle() {
    if (!cycleId) return
    if (!confirm('Excluir este ciclo de FP? O histórico anterior permanece.')) return
    try {
      await deleteFPCycle(cycleId)
      toast.success('Ciclo excluído')
      onSaved?.()
      onClose()
    } catch {
      toast.error('Erro ao excluir')
    }
  }

  if (!client) return null

  const history = (client.fpHistory || []).filter(c => c.id !== cycleId)

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <aside className="relative bg-white w-full max-w-lg h-full shadow-xl flex flex-col">
        <header className="px-6 py-4 border-b border-gray-100 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display font-semibold text-navy-500 truncate">{client.name}</h3>
            <p className="text-xs text-gray-400 font-mono mt-0.5">
              {client.client_code ? `Código ${client.client_code}` : 'Sem código'}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 shrink-0">
            <X size={20} />
          </button>
        </header>

        <div className="px-6 pt-4 flex gap-1 border-b border-gray-100">
          {[['fp', 'Financial Planning'], ['produtos', 'Produtos']].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setActive(key)}
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                active === key
                  ? 'border-accent-500 text-navy-500'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {active === 'fp' ? (
            <>
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-navy-500">
                  {cycleId ? 'Ciclo de FP atual' : 'Novo ciclo de FP'}
                </h4>
                {cycleId && (
                  <button
                    onClick={() => { setCycleId(null); loadCycle(null) }}
                    className="text-xs text-accent-600 hover:underline flex items-center gap-1"
                  >
                    <Plus size={12} /> Começar novo ciclo
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Field label="Reunião de FP agendada">
                  <input type="date" value={cycle.meeting_scheduled_at}
                    onChange={e => setCycle({ ...cycle, meeting_scheduled_at: e.target.value })}
                    className="input" />
                </Field>
                <Field label="FP realizado em">
                  <input type="date" value={cycle.completed_at}
                    onChange={e => setCycle({ ...cycle, completed_at: e.target.value })}
                    className="input" />
                </Field>
              </div>

              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={cycle.in_execution}
                  onChange={e => setCycle({ ...cycle, in_execution: e.target.checked })}
                  className="rounded" />
                Financial planning em execução
              </label>

              <Field label="Data do próximo FP"
                hint="Definida agora, no cadastro deste FP — é o que alimenta o alerta de vencimento.">
                <input type="date" value={cycle.next_fp_date}
                  onChange={e => setCycle({ ...cycle, next_fp_date: e.target.value })}
                  className="input" />
              </Field>

              <Field label="Principais combinados a monitorar" hint="Um por linha.">
                <textarea rows={5} value={combinadosText}
                  onChange={e => setCombinadosText(e.target.value)}
                  placeholder={'Revisar previdência até dezembro\nAumentar aporte mensal para 5k'}
                  className="input font-normal" />
              </Field>

              <Field label="Observações">
                <textarea rows={3} value={cycle.notes || ''}
                  onChange={e => setCycle({ ...cycle, notes: e.target.value })}
                  className="input" />
              </Field>

              {freeTextHasCPF && (
                <div className="flex gap-2 p-3 bg-red-50 border border-red-100 rounded-lg text-xs text-red-700">
                  <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                  <span>
                    Há um CPF no texto. Ele será removido automaticamente ao salvar —
                    documentos de cliente não vão para o banco.
                  </span>
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button onClick={handleSaveFP} disabled={saving} className="btn-primary gap-1.5">
                  <Save size={15} /> {saving ? 'Salvando...' : 'Salvar FP'}
                </button>
                {cycleId && (
                  <button onClick={handleDeleteCycle} className="btn-danger gap-1.5">
                    <Trash2 size={14} /> Excluir ciclo
                  </button>
                )}
              </div>

              {history.length > 0 && (
                <div className="pt-4 border-t border-gray-100">
                  <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                    Histórico ({history.length})
                  </h4>
                  <ul className="space-y-2">
                    {history.map(h => (
                      <li key={h.id} className="text-xs text-gray-600 bg-gray-50 rounded-lg px-3 py-2">
                        <button onClick={() => loadCycle(h)} className="font-medium text-navy-500 hover:underline">
                          FP de {formatDate(h.completed_at || h.meeting_scheduled_at)}
                        </button>
                        <span className="text-gray-400"> · próximo {formatDate(h.next_fp_date)}</span>
                        {h.combinados?.length > 0 && (
                          <span className="text-gray-400"> · {h.combinados.length} combinado(s)</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="space-y-3">
                {PRODUCTS.map(p => (
                  <div key={p.field}>
                    <label className="flex items-center gap-2 text-sm text-gray-700">
                      <input type="checkbox" checked={!!products[p.field]}
                        onChange={e => setProducts({ ...products, [p.field]: e.target.checked })}
                        className="rounded" />
                      {p.label}
                    </label>
                    {p.detail && products[p.field] && (
                      <input
                        type="text"
                        value={products[p.detail.field] || ''}
                        onChange={e => setProducts({ ...products, [p.detail.field]: e.target.value })}
                        placeholder={p.detail.label}
                        className="input mt-2 ml-6 w-[calc(100%-1.5rem)]"
                      />
                    )}
                  </div>
                ))}
              </div>

              <button onClick={handleSaveProducts} disabled={saving} className="btn-primary gap-1.5">
                <Save size={15} /> {saving ? 'Salvando...' : 'Salvar produtos'}
              </button>
            </>
          )}
        </div>
      </aside>
    </div>
  )
}

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  )
}
