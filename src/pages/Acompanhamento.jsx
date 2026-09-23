import { useState, useEffect, useMemo } from 'react'
import { Search, Download, Check } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '../hooks/useAuth'
import { getClientTracking } from '../lib/api'
import ClientDrawer from '../components/ClientDrawer'
import {
  PRODUCTS, STATUS_PRODUTO, TONS_STATUS, statusProduto, contarAtivos, contarAbertos,
  PROXIMIDADE, INDICACAO, rotuloDe, fpStage, STAGE_TONES, nextFPStatus, formatDate,
} from '../lib/tracking'

const FP_FILTERS = [
  ['todos', 'Todos'],
  ['agendada', 'Reunião agendada'],
  ['realizado', 'Realizado'],
  ['em_execucao', 'Em execução'],
  ['sem_fp', 'Sem FP'],
  ['vencendo', 'Vencendo em 30d'],
]

/**
 * Visão consolidada dos clientes, em formato de planilha.
 * Duas abas: Financial Planning e Produtos contratados. Clicar em qualquer
 * linha abre o painel de edição daquele cliente.
 */
export default function Acompanhamento() {
  const { team } = useAuth()
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('fp')
  const [search, setSearch] = useState('')
  const [fpFilter, setFpFilter] = useState('todos')
  const [onlyTracked, setOnlyTracked] = useState(false)
  const [selected, setSelected] = useState(null)

  useEffect(() => { if (team?.id) load() }, [team?.id])

  async function load() {
    setLoading(true)
    try {
      setClients(await getClientTracking(team.id))
    } catch (err) {
      toast.error('Erro ao carregar acompanhamento: ' + (err.message || ''))
    } finally {
      setLoading(false)
    }
  }

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return clients.filter(c => {
      if (q && !(
        c.name?.toLowerCase().includes(q) ||
        c.client_code?.toLowerCase().includes(q) ||
        c.phone?.includes(q)
      )) return false

      if (onlyTracked && !c.currentFP && !c.perfil && Object.keys(c.produtos || {}).length === 0) return false

      if (fpFilter === 'todos') return true
      if (fpFilter === 'vencendo') {
        const status = nextFPStatus(c.currentFP?.next_fp_date)
        return status !== null && status.days <= 30
      }
      return fpStage(c.currentFP).key === fpFilter
    })
  }, [clients, search, fpFilter, onlyTracked])

  // Contadores do topo — leem a base inteira, não o filtro atual.
  const stats = useMemo(() => {
    let vencendo = 0, emExecucao = 0, semFP = 0
    for (const c of clients) {
      const status = nextFPStatus(c.currentFP?.next_fp_date)
      if (status && status.days <= 30) vencendo++
      if (c.currentFP?.in_execution) emExecucao++
      if (!c.currentFP) semFP++
    }
    return { total: clients.length, vencendo, emExecucao, semFP }
  }, [clients])

  function exportCSV() {
    const header = tab === 'fp'
      ? ['Cliente', 'Código', 'Reunião agendada', 'FP realizado', 'Em execução', 'Próximo FP', 'Combinados']
      : tab === 'produtos'
        ? ['Cliente', 'Código', 'Ativos', 'Em aberto', ...PRODUCTS.map(p => p.label)]
        : ['Cliente', 'Código', 'Proximidade', 'Indicação', 'Nº indicações', 'Último feedback', 'Liquidez', 'Cross sell', 'Observações']

    const lines = rows.map(c => {
      if (tab === 'fp') {
        const fp = c.currentFP
        return [
          c.name, c.client_code || '',
          fp?.meeting_scheduled_at ? formatDate(fp.meeting_scheduled_at) : '',
          fp?.completed_at ? formatDate(fp.completed_at) : '',
          fp?.in_execution ? 'Sim' : 'Não',
          fp?.next_fp_date ? formatDate(fp.next_fp_date) : '',
          (fp?.combinados || []).map(x => x.texto).join(' | '),
        ]
      }
      if (tab === 'produtos') {
        return [
          c.name, c.client_code || '', contarAtivos(c.produtos), contarAbertos(c.produtos),
          ...PRODUCTS.map(prod => {
            const l = c.produtos?.[prod.key]
            if (!l) return ''
            const st = statusProduto(l.status).label
            return l.detalhe ? `${st} (${l.detalhe})` : st
          }),
        ]
      }
      const p = c.perfil
      return [
        c.name, c.client_code || '',
        rotuloDe(PROXIMIDADE, p?.proximidade) || '',
        rotuloDe(INDICACAO, p?.indicacao) || '',
        p?.num_indicacoes ?? '',
        p?.feedback_carteira ? formatDate(p.feedback_carteira) : '',
        p?.liquidez || '', p?.obs_cross_sell || '', p?.observacoes || '',
      ]
    })

    const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const csv = [header, ...lines].map(r => r.map(escape).join(',')).join('\n')
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `acompanhamento_${tab}_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-display font-bold text-navy-500">Acompanhamento</h2>
          <p className="text-sm text-gray-400 mt-0.5">
            Financial Planning, esteira de produtos e relacionamento — um cliente por linha.
          </p>
        </div>
        <button onClick={exportCSV} disabled={rows.length === 0} className="btn-secondary text-xs gap-1.5">
          <Download size={14} /> Exportar CSV
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Stat label="Clientes" value={stats.total} />
        <Stat label="FP vencendo em 30d" value={stats.vencendo} tone="text-red-600"
          onClick={() => { setTab('fp'); setFpFilter('vencendo') }} />
        <Stat label="Em execução" value={stats.emExecucao} tone="text-emerald-700"
          onClick={() => { setTab('fp'); setFpFilter('em_execucao') }} />
        <Stat label="Sem FP" value={stats.semFP} tone="text-gray-400"
          onClick={() => { setTab('fp'); setFpFilter('sem_fp') }} />
      </div>

      <div className="flex gap-1 border-b border-gray-200 mb-4">
        {[['fp', 'Financial Planning'], ['produtos', 'Produtos'], ['relacao', 'Relacionamento']].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === key
                ? 'border-accent-500 text-navy-500'
                : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex flex-col lg:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nome, código ou telefone..."
            className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-accent-500 focus:border-transparent outline-none"
          />
        </div>
        {tab === 'fp' && (
          <select value={fpFilter} onChange={e => setFpFilter(e.target.value)}
            className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-accent-500">
            {FP_FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        )}
        <label className="flex items-center gap-2 text-sm text-gray-600 whitespace-nowrap px-1">
          <input type="checkbox" checked={onlyTracked}
            onChange={e => setOnlyTracked(e.target.checked)} className="rounded" />
          Só com acompanhamento
        </label>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center">
            <div className="animate-spin w-6 h-6 border-2 border-navy-500 border-t-transparent rounded-full mx-auto" />
          </div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-gray-400 text-sm">
            {clients.length === 0
              ? 'Nenhum contato ainda. Importe seus clientes em Contatos para começar.'
              : 'Nenhum cliente com esses filtros.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            {tab === 'fp' ? <FPTable rows={rows} onPick={setSelected} />
              : tab === 'produtos' ? <ProductsTable rows={rows} onPick={setSelected} />
              : <RelacaoTable rows={rows} onPick={setSelected} />}
          </div>
        )}
        <div className="px-4 py-3 border-t border-gray-100 text-xs text-gray-400">
          {rows.length} cliente(s) · clique numa linha para editar
        </div>
      </div>

      {selected && (
        <ClientDrawer
          client={clients.find(c => c.id === selected.id) || selected}
          tab={tab}
          onClose={() => setSelected(null)}
          onSaved={load}
        />
      )}
    </div>
  )
}

function FPTable({ rows, onPick }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="bg-gray-50 border-b border-gray-100">
          <Th sticky>Cliente</Th>
          <Th>Situação</Th>
          <Th>Reunião agendada</Th>
          <Th>FP realizado</Th>
          <Th>Em execução</Th>
          <Th>Próximo FP</Th>
          <Th>Principais combinados</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-50">
        {rows.map(c => {
          const fp = c.currentFP
          const stage = fpStage(fp)
          const next = nextFPStatus(fp?.next_fp_date)
          const combinados = fp?.combinados || []
          return (
            <tr key={c.id} onClick={() => onPick(c)} className="hover:bg-gray-50/70 cursor-pointer">
              <td className="px-4 py-3 sticky left-0 bg-white hover:bg-gray-50/70">
                <div className="font-medium text-gray-900 whitespace-nowrap">{c.name}</div>
                {c.client_code && (
                  <div className="text-xs text-gray-400 font-mono">{c.client_code}</div>
                )}
              </td>
              <td className="px-4 py-3">
                <span className={`px-2 py-0.5 rounded text-xs whitespace-nowrap ${STAGE_TONES[stage.tone]}`}>
                  {stage.label}
                </span>
              </td>
              <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{formatDate(fp?.meeting_scheduled_at)}</td>
              <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{formatDate(fp?.completed_at)}</td>
              <td className="px-4 py-3">
                {fp?.in_execution
                  ? <Check size={16} className="text-emerald-600" />
                  : <span className="text-gray-300">—</span>}
              </td>
              <td className="px-4 py-3 whitespace-nowrap">
                {next
                  ? <span className={`px-2 py-0.5 rounded text-xs ${next.tone}`} title={formatDate(fp.next_fp_date)}>
                      {next.label}
                    </span>
                  : <span className="text-gray-300">—</span>}
              </td>
              <td className="px-4 py-3 text-gray-600 max-w-xs">
                {combinados.length === 0 ? (
                  <span className="text-gray-300">—</span>
                ) : (
                  <span className="line-clamp-2" title={combinados.map(x => x.texto).join(' · ')}>
                    {combinados.map(x => x.texto).join(' · ')}
                  </span>
                )}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function ProductsTable({ rows, onPick }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="bg-gray-50 border-b border-gray-100">
          <Th sticky>Cliente</Th>
          <Th center title="Produtos fechados ou que o cliente já possui">Ativos</Th>
          <Th center title="Produtos ainda em aberto na esteira">Em aberto</Th>
          {PRODUCTS.map(p => <Th key={p.key} center title={p.label}>{p.short}</Th>)}
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-50">
        {rows.map(c => {
          const ativos = contarAtivos(c.produtos)
          const abertos = contarAbertos(c.produtos)
          return (
            <tr key={c.id} onClick={() => onPick(c)} className="hover:bg-gray-50/70 cursor-pointer">
              <td className="px-4 py-3 sticky left-0 bg-white hover:bg-gray-50/70">
                <div className="font-medium text-gray-900 whitespace-nowrap">{c.name}</div>
                {c.client_code && (
                  <div className="text-xs text-gray-400 font-mono">{c.client_code}</div>
                )}
              </td>
              <td className="px-4 py-3 text-center">
                <span className={`px-2 py-0.5 rounded text-xs ${
                  ativos > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-400'}`}>
                  {ativos}
                </span>
              </td>
              <td className="px-4 py-3 text-center">
                <span className={`px-2 py-0.5 rounded text-xs ${
                  abertos > 0 ? 'bg-accent-100 text-accent-600' : 'bg-gray-100 text-gray-400'}`}>
                  {abertos}
                </span>
              </td>
              {PRODUCTS.map(prod => {
                const linha = c.produtos?.[prod.key]
                const st = statusProduto(linha?.status)
                const vazio = !linha
                return (
                  <td key={prod.key} className="px-3 py-3 text-center"
                      title={`${prod.label}: ${vazio ? 'não registrado' : st.label}${
                        linha?.detalhe ? ` (${linha.detalhe})` : ''}`}>
                    {vazio ? (
                      <span className="text-gray-200">—</span>
                    ) : (
                      <span className={`px-2 py-0.5 rounded text-xs whitespace-nowrap ${TONS_STATUS[st.tom]}`}>
                        {linha.detalhe || st.label}
                      </span>
                    )}
                  </td>
                )
              })}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function RelacaoTable({ rows, onPick }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="bg-gray-50 border-b border-gray-100">
          <Th sticky>Cliente</Th>
          <Th>Proximidade</Th>
          <Th>Indicação</Th>
          <Th center>Nº</Th>
          <Th>Último feedback</Th>
          <Th>Liquidez</Th>
          <Th>Observações</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-50">
        {rows.map(c => {
          const p = c.perfil
          const prox = PROXIMIDADE.find(x => x.key === p?.proximidade)
          const ind = INDICACAO.find(x => x.key === p?.indicacao)
          return (
            <tr key={c.id} onClick={() => onPick(c)} className="hover:bg-gray-50/70 cursor-pointer">
              <td className="px-4 py-3 sticky left-0 bg-white hover:bg-gray-50/70">
                <div className="font-medium text-gray-900 whitespace-nowrap">{c.name}</div>
                {c.client_code && <div className="text-xs text-gray-400 font-mono">{c.client_code}</div>}
              </td>
              <td className="px-4 py-3">
                {prox ? <span className={`px-2 py-0.5 rounded text-xs whitespace-nowrap ${TONS_STATUS[prox.tom]}`}>
                  {prox.label}</span> : <span className="text-gray-300">—</span>}
              </td>
              <td className="px-4 py-3">
                {ind ? <span className={`px-2 py-0.5 rounded text-xs whitespace-nowrap ${TONS_STATUS[ind.tom]}`}>
                  {ind.label}</span> : <span className="text-gray-300">—</span>}
              </td>
              <td className="px-4 py-3 text-center text-gray-600">{p?.num_indicacoes ?? '—'}</td>
              <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{formatDate(p?.feedback_carteira)}</td>
              <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{p?.liquidez || '—'}</td>
              <td className="px-4 py-3 text-gray-600 max-w-xs">
                {p?.observacoes || p?.obs_cross_sell
                  ? <span className="line-clamp-2" title={[p.obs_cross_sell, p.observacoes].filter(Boolean).join(' · ')}>
                      {[p.obs_cross_sell, p.observacoes].filter(Boolean).join(' · ')}
                    </span>
                  : <span className="text-gray-300">—</span>}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function Th({ children, center, sticky, title }) {
  return (
    <th title={title}
      className={`px-4 py-3 font-medium text-gray-500 whitespace-nowrap ${center ? 'text-center' : 'text-left'} ${
        sticky ? 'sticky left-0 bg-gray-50 z-10' : ''}`}>
      {children}
    </th>
  )
}

function Stat({ label, value, tone = 'text-navy-500', onClick }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag onClick={onClick}
      className={`bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3 text-left ${
        onClick ? 'hover:border-accent-300 transition-colors' : ''}`}>
      <p className="text-xs text-gray-400">{label}</p>
      <p className={`text-2xl font-display font-bold mt-0.5 ${tone}`}>{value}</p>
    </Tag>
  )
}
