import { useState, useEffect } from 'react'
import { X, Plus, Trash2, Save, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '../hooks/useAuth'
import { saveProductStatus, saveClientProfile, createFPCycle, updateFPCycle, deleteFPCycle } from '../lib/api'
import { PRODUCTS, STATUS_PRODUTO, TONS_STATUS, statusProduto, PROXIMIDADE, INDICACAO,
         formatDate, combinadosToText, textToCombinados } from '../lib/tracking'
import { containsCPF, redactCPFs } from '../lib/privacy'
import LembretesRecorrentes from './LembretesRecorrentes'

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

  const [produtos, setProdutos] = useState({})
  const [perfil, setPerfil] = useState({})
  const [cycle, setCycle] = useState(EMPTY_CYCLE)
  const [cycleId, setCycleId] = useState(null)
  const [combinadosText, setCombinadosText] = useState('')

  useEffect(() => {
    setProdutos(client?.produtos || {})
    setPerfil(client?.perfil || {})
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

  async function mudarProduto(produtoKey, campo, valor) {
    const atual = produtos[produtoKey] || {}
    const proximo = { ...atual, [campo]: valor }
    // Otimista: o chip muda na hora; um erro recarrega a verdade do banco.
    setProdutos(p => ({ ...p, [produtoKey]: proximo }))
    try {
      await saveProductStatus(team.id, client.id, produtoKey, {
        status: proximo.status || 'oferecer',
        detalhe: proximo.detalhe || null,
        observacao: proximo.observacao || null,
      }, user.id)
      onSaved?.()
    } catch (err) {
      toast.error('Erro ao salvar: ' + (err.message || ''))
      setProdutos(p => ({ ...p, [produtoKey]: atual }))
    }
  }

  async function salvarPerfil() {
    setSaving(true)
    try {
      await saveClientProfile(team.id, client.id, {
        proximidade: perfil.proximidade || null,
        indicacao: perfil.indicacao || null,
        num_indicacoes: perfil.num_indicacoes === '' || perfil.num_indicacoes == null
          ? null : Number(perfil.num_indicacoes),
        indicacao_obs: perfil.indicacao_obs || null,
        feedback_carteira: perfil.feedback_carteira || null,
        liquidez: perfil.liquidez || null,
        obs_cross_sell: redactCPFs(perfil.obs_cross_sell) || null,
        observacoes: redactCPFs(perfil.observacoes) || null,
      }, user.id)
      toast.success('Relacionamento salvo')
      onSaved?.()
    } catch (err) {
      toast.error('Erro ao salvar: ' + (err.message || ''))
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
          {[['fp', 'FP'], ['produtos', 'Produtos'], ['relacao', 'Relacionamento']].map(([key, label]) => (
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

              <LembretesRecorrentes
                teamId={team.id}
                userId={user.id}
                client={client}
                cycleId={cycleId}
                combinados={textToCombinados(combinadosText, cycle.combinados)}
                onChanged={onSaved}
              />

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
          ) : active === 'produtos' ? (
            <>
              <p className="text-xs text-gray-400">
                Cada produto guarda em que ponto a conversa está. Muda na hora ao clicar.
              </p>

              <div className="space-y-4">
                {PRODUCTS.map(p => {
                  const atual = produtos[p.key] || {}
                  const st = statusProduto(atual.status)
                  const emConversa = !['na', 'nao_quer', 'negado'].includes(st.key)
                  return (
                    <div key={p.key} className="border border-gray-100 rounded-lg p-3">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div>
                          <p className="text-sm font-medium text-gray-800">{p.label}</p>
                          {p.hint && <p className="text-xs text-gray-400 mt-0.5">{p.hint}</p>}
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded shrink-0 ${TONS_STATUS[st.tom]}`}>
                          {st.label}
                        </span>
                      </div>

                      <div className="flex flex-wrap gap-1">
                        {STATUS_PRODUTO.map(op => (
                          <button key={op.key}
                            onClick={() => mudarProduto(p.key, 'status', op.key)}
                            className={`text-xs px-2 py-1 rounded border transition-colors ${
                              atual.status === op.key
                                ? `${TONS_STATUS[op.tom]} border-transparent font-medium`
                                : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
                            {op.label}
                          </button>
                        ))}
                      </div>

                      {p.detalhe && emConversa && (
                        <input
                          defaultValue={atual.detalhe || ''}
                          onBlur={e => {
                            if ((e.target.value || '') !== (atual.detalhe || ''))
                              mudarProduto(p.key, 'detalhe', e.target.value)
                          }}
                          placeholder={p.detalhe}
                          className="input mt-2 text-xs" />
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Grau de proximidade">
                  <select value={perfil.proximidade || ''}
                    onChange={e => setPerfil({ ...perfil, proximidade: e.target.value })}
                    className="input">
                    <option value="">—</option>
                    {PROXIMIDADE.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                  </select>
                </Field>
                <Field label="Indicação">
                  <select value={perfil.indicacao || ''}
                    onChange={e => setPerfil({ ...perfil, indicacao: e.target.value })}
                    className="input">
                    <option value="">—</option>
                    {INDICACAO.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                  </select>
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Field label="Nº de indicações">
                  <input type="number" min={0} value={perfil.num_indicacoes ?? ''}
                    onChange={e => setPerfil({ ...perfil, num_indicacoes: e.target.value })}
                    className="input" />
                </Field>
                <Field label="Último feedback de carteira">
                  <input type="date" value={perfil.feedback_carteira || ''}
                    onChange={e => setPerfil({ ...perfil, feedback_carteira: e.target.value })}
                    className="input" />
                </Field>
              </div>

              <Field label="Observação sobre indicações">
                <input value={perfil.indicacao_obs || ''}
                  onChange={e => setPerfil({ ...perfil, indicacao_obs: e.target.value })}
                  placeholder="Ex.: pedi com NPS (10/07/26)" className="input" />
              </Field>

              <Field label="Liquidez" hint="Como você anota hoje: reserva e gasto mensal juntos.">
                <input value={perfil.liquidez || ''}
                  onChange={e => setPerfil({ ...perfil, liquidez: e.target.value })}
                  placeholder="Ex.: 24k (gasto 4k)" className="input" />
              </Field>

              <Field label="Observações de cross sell">
                <textarea rows={3} value={perfil.obs_cross_sell || ''}
                  onChange={e => setPerfil({ ...perfil, obs_cross_sell: e.target.value })}
                  className="input" />
              </Field>

              <Field label="Observações gerais">
                <textarea rows={3} value={perfil.observacoes || ''}
                  onChange={e => setPerfil({ ...perfil, observacoes: e.target.value })}
                  className="input" />
              </Field>

              {(containsCPF(perfil.obs_cross_sell) || containsCPF(perfil.observacoes)) && (
                <div className="flex gap-2 p-3 bg-red-50 border border-red-100 rounded-lg text-xs text-red-700">
                  <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                  <span>Há um CPF nas observações. Ele será removido ao salvar.</span>
                </div>
              )}

              <button onClick={salvarPerfil} disabled={saving} className="btn-primary gap-1.5">
                <Save size={15} /> {saving ? 'Salvando...' : 'Salvar relacionamento'}
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
