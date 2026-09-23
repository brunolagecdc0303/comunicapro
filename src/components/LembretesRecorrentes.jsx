import { useState, useEffect } from 'react'
import { Repeat, Plus, Trash2, Save, Power, PowerOff, AlertTriangle, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { getFPLembretesDoCliente, saveFPLembrete, setFPLembreteAtivo, deleteFPLembrete } from '../lib/api'
import { FREQUENCIAS, DIAS_DA_SEMANA, proximoEnvio, descreverRecorrencia, formatDate } from '../lib/tracking'
import { containsCPF } from '../lib/privacy'

const HORAS = Array.from({ length: 13 }, (_, i) => String(i + 8).padStart(2, '0') + ':00')

const VAZIO = {
  id: null,
  titulo: '',
  template: 'Oi {{nome}}! Passando para lembrar do seu aporte mensal. Posso ajudar em algo?',
  frequencia: 'mensal',
  dia_do_mes: 15,
  dia_da_semana: 1,
  hora: '09:00',
  inicio: new Date().toISOString().slice(0, 10),
  fim: '',
  ativo: true,
  copia_assessor: false,
}

/**
 * Lembretes que se repetem, cadastrados de dentro do FP.
 * O combinado do FP ("aportar todo dia 15") deixa de ser uma anotação que
 * alguém precisa lembrar de olhar e vira uma mensagem que sai sozinha.
 */
export default function LembretesRecorrentes({ teamId, userId, client, cycleId, combinados, onChanged }) {
  const [lembretes, setLembretes] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [form, setForm] = useState(null)
  const [salvando, setSalvando] = useState(false)

  useEffect(() => { if (teamId && client?.id) carregar() }, [teamId, client?.id])

  async function carregar() {
    setCarregando(true)
    try { setLembretes(await getFPLembretesDoCliente(teamId, client.id)) }
    catch (err) { toast.error('Erro ao carregar lembretes: ' + (err.message || '')) }
    finally { setCarregando(false) }
  }

  const semTelefone = !client?.phone

  function abrirNovo(titulo = '') {
    setForm({ ...VAZIO, titulo, fp_cycle_id: cycleId || null })
  }

  async function salvar() {
    if (!form.titulo.trim()) return toast.error('Dê um nome ao lembrete')
    if (!form.template.trim()) return toast.error('Escreva a mensagem')
    setSalvando(true)
    try {
      await saveFPLembrete(teamId, client.id, { ...form, fp_cycle_id: form.fp_cycle_id || cycleId || null }, userId)
      toast.success(form.id ? 'Lembrete atualizado' : 'Lembrete criado')
      setForm(null)
      await carregar()
      onChanged?.()
    } catch (err) {
      toast.error('Erro ao salvar: ' + (err.message || ''))
    } finally {
      setSalvando(false)
    }
  }

  async function alternar(l) {
    try {
      await setFPLembreteAtivo(l.id, !l.ativo)
      setLembretes(ls => ls.map(x => x.id === l.id ? { ...x, ativo: !x.ativo } : x))
    } catch (err) {
      toast.error('Erro ao alterar: ' + (err.message || ''))
    }
  }

  async function excluir(l) {
    if (!confirm(`Excluir o lembrete "${l.titulo}"? Ele para de sair a partir de agora.`)) return
    try {
      await deleteFPLembrete(l.id)
      toast.success('Lembrete excluído')
      await carregar()
      onChanged?.()
    } catch (err) {
      toast.error('Erro ao excluir: ' + (err.message || ''))
    }
  }

  // Combinados que ainda não viraram lembrete — o atalho que liga uma coisa na outra.
  const jaViraram = new Set(lembretes.map(l => l.titulo.trim().toLowerCase()))
  const sugestoes = (combinados || [])
    .map(c => (typeof c === 'string' ? c : c?.texto) || '')
    .filter(t => t.trim() && !jaViraram.has(t.trim().toLowerCase()))
    .slice(0, 4)

  return (
    <div className="pt-4 border-t border-gray-100">
      <div className="flex items-center justify-between mb-1">
        <h4 className="text-sm font-semibold text-navy-500 flex items-center gap-1.5">
          <Repeat size={14} /> Lembretes recorrentes
        </h4>
        {!form && (
          <button onClick={() => abrirNovo()} className="text-xs text-accent-600 hover:underline flex items-center gap-1">
            <Plus size={12} /> Novo lembrete
          </button>
        )}
      </div>
      <p className="text-xs text-gray-400 mb-3">
        A mensagem sai sozinha na data combinada, todo mês ou toda semana, até você desligar.
      </p>

      {semTelefone && (
        <div className="flex gap-2 p-3 mb-3 bg-accent-50 border border-accent-100 rounded-lg text-xs text-accent-700">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>Este cliente está sem telefone — o lembrete fica cadastrado, mas não sai enquanto o número não for preenchido.</span>
        </div>
      )}

      {carregando ? (
        <p className="text-xs text-gray-400">Carregando...</p>
      ) : lembretes.length === 0 && !form ? (
        <p className="text-xs text-gray-400">Nenhum lembrete recorrente para este cliente.</p>
      ) : (
        <ul className="space-y-2 mb-3">
          {lembretes.map(l => {
            const proximo = proximoEnvio(l)
            return (
              <li key={l.id} className={`rounded-lg border px-3 py-2 ${l.ativo ? 'border-gray-100 bg-gray-50' : 'border-gray-100 bg-white opacity-60'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <button
                      onClick={() => setForm({ ...VAZIO, ...l, fim: l.fim || '', hora: String(l.hora).slice(0, 5) })}
                      className="text-sm font-medium text-navy-500 hover:underline text-left truncate block"
                    >
                      {l.titulo}
                    </button>
                    <p className="text-xs text-gray-500 mt-0.5">{descreverRecorrencia(l)}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {l.ativo
                        ? (proximo ? `Próximo envio: ${proximo.toLocaleDateString('pt-BR')}` : 'Sem próximo envio — período encerrado')
                        : 'Desligado'}
                      {l.total_enviado > 0 && ` · ${l.total_enviado} enviado(s)`}
                      {l.ultimo_envio_em && ` · último em ${formatDate(l.ultimo_envio_em)}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => alternar(l)} title={l.ativo ? 'Desligar' : 'Ligar'}
                      className={l.ativo ? 'text-emerald-600 hover:text-emerald-700' : 'text-gray-400 hover:text-gray-600'}>
                      {l.ativo ? <Power size={15} /> : <PowerOff size={15} />}
                    </button>
                    <button onClick={() => excluir(l)} title="Excluir" className="text-gray-400 hover:text-red-500">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {!form && sugestoes.length > 0 && (
        <div className="mb-3">
          <p className="text-xs text-gray-400 mb-1.5">Transformar um combinado em lembrete:</p>
          <div className="flex flex-wrap gap-1">
            {sugestoes.map(t => (
              <button key={t} onClick={() => abrirNovo(t)}
                className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-600 hover:bg-gray-50 max-w-full truncate">
                <Plus size={10} className="inline mr-0.5" />{t}
              </button>
            ))}
          </div>
        </div>
      )}

      {form && (
        <div className="border border-accent-200 rounded-lg p-3 space-y-3 bg-white">
          <div className="flex items-center justify-between">
            <h5 className="text-xs font-semibold text-navy-500">
              {form.id ? 'Editar lembrete' : 'Novo lembrete'}
            </h5>
            <button onClick={() => setForm(null)} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Nome do lembrete</label>
            <input value={form.titulo} onChange={e => setForm({ ...form, titulo: e.target.value })}
              placeholder="Ex.: Aporte mensal" className="input text-sm" />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Repetir</label>
              <select value={form.frequencia} onChange={e => setForm({ ...form, frequencia: e.target.value })}
                className="input text-sm">
                {FREQUENCIAS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                {form.frequencia === 'semanal' ? 'Dia da semana' : 'Dia do mês'}
              </label>
              {form.frequencia === 'semanal' ? (
                <select value={form.dia_da_semana} onChange={e => setForm({ ...form, dia_da_semana: Number(e.target.value) })}
                  className="input text-sm">
                  {DIAS_DA_SEMANA.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
                </select>
              ) : (
                <select value={form.dia_do_mes} onChange={e => setForm({ ...form, dia_do_mes: Number(e.target.value) })}
                  className="input text-sm">
                  {Array.from({ length: 31 }, (_, i) => i + 1).map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              )}
            </div>
          </div>

          {form.frequencia === 'mensal' && form.dia_do_mes > 28 && (
            <p className="text-xs text-gray-400">
              Em meses mais curtos o lembrete sai no último dia do mês — nenhum mês é pulado.
            </p>
          )}

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Hora</label>
              <select value={form.hora} onChange={e => setForm({ ...form, hora: e.target.value })} className="input text-sm">
                {HORAS.map(h => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Começa em</label>
              <input type="date" value={form.inicio} onChange={e => setForm({ ...form, inicio: e.target.value })}
                className="input text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Até (opcional)</label>
              <input type="date" value={form.fim || ''} onChange={e => setForm({ ...form, fim: e.target.value })}
                className="input text-sm" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Mensagem</label>
            <textarea rows={4} value={form.template} onChange={e => setForm({ ...form, template: e.target.value })}
              className="input text-sm font-normal" />
            <p className="text-xs text-gray-400 mt-1">
              {'{{nome}}'} vira o nome do cliente, {'{{data}}'} a data do envio e {'{{titulo}}'} o nome do lembrete.
            </p>
          </div>

          {containsCPF(form.template) && (
            <div className="flex gap-2 p-2 bg-red-50 border border-red-100 rounded text-xs text-red-700">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>Há um CPF na mensagem. Ele será removido ao salvar.</span>
            </div>
          )}

          <label className="flex items-center gap-2 text-xs text-gray-700">
            <input type="checkbox" checked={form.copia_assessor}
              onChange={e => setForm({ ...form, copia_assessor: e.target.checked })} className="rounded" />
            Me avisar no dia (um resumo, não uma cópia por cliente)
          </label>

          {(() => {
            const proximo = proximoEnvio({ ...form, ativo: true })
            return (
              <p className="text-xs text-gray-500 bg-gray-50 rounded px-2 py-1.5">
                {proximo
                  ? <>Primeiro envio em <strong>{proximo.toLocaleDateString('pt-BR')}</strong>, às {form.hora}.</>
                  : 'Com esse período, o lembrete nunca chega a sair.'}
              </p>
            )
          })()}

          <div className="flex gap-2">
            <button onClick={salvar} disabled={salvando} className="btn-primary gap-1.5 text-sm">
              <Save size={14} /> {salvando ? 'Salvando...' : 'Salvar lembrete'}
            </button>
            <button onClick={() => setForm(null)} className="btn-secondary text-sm">Cancelar</button>
          </div>
        </div>
      )}
    </div>
  )
}
