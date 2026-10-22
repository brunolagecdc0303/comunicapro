import { useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import {
  CalendarClock, CheckCircle2, Circle, ExternalLink, FileText, FolderOpen,
  Link2, Plus, Search, Upload, X, ChevronRight, Sparkles, UserMinus,
} from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { formatDate } from '../lib/tracking'
import {
  ETAPAS, rotuloDias, hojeISO, setNaJornada, salvarPerfilJornada, vincularDiagnostico,
  salvarCombinados, subirFP, processarFP, abrirPDF,
} from '../lib/jornada'

const TONS_ALERTA = {
  3: 'bg-red-50 text-red-700',
  2: 'bg-accent-100 text-accent-600',
  1: 'bg-gray-100 text-gray-500',
}

const TONS_ETAPA = {
  sem_diagnostico: 'border-t-gray-300',
  diagnostico: 'border-t-accent-400',
  implantacao: 'border-t-navy-400',
  acompanhamento: 'border-t-emerald-500',
}

/**
 * Visão principal do Acompanhamento: "Hoje" no topo e o quadro da jornada.
 * Recebe os dados prontos (getJornada) e um recarregar() para depois de cada ação.
 */
export function JornadaView({ dados, recarregar, onAbrirCompleto, abrirInicial = null }) {
  const { team, user } = useAuth()
  const [busca, setBusca] = useState('')
  const [aberto, setAberto] = useState(abrirInicial)
  const [adicionando, setAdicionando] = useState(false)

  const naJornada = useMemo(() => dados.clientes.filter(c => c.naJornada), [dados])
  const q = busca.trim().toLowerCase()
  const visiveis = q
    ? naJornada.filter(c => c.name?.toLowerCase().includes(q) || c.client_code?.includes(q))
    : naJornada

  const hoje = useMemo(() => naJornada
    .filter(c => c.pedeAcao)
    .sort((a, b) => (b.alertas[0]?.urg || 0) - (a.alertas[0]?.urg || 0)), [naJornada])

  const porEtapa = useMemo(() => {
    const m = Object.fromEntries(ETAPAS.map(e => [e.key, []]))
    for (const c of visiveis) m[c.etapa].push(c)
    return m
  }, [visiveis])

  const comFP = naJornada.filter(c => c.fp).length
  const clienteAberto = aberto ? dados.clientes.find(c => c.id === aberto) : null

  return (
    <div className="space-y-6">
      {/* Placar */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Placar rotulo="Na jornada" valor={naJornada.length} />
        <Placar rotulo="Com FP entregue" valor={`${comFP} de ${naJornada.length}`}
          detalhe={naJornada.length ? `${Math.round((comFP / naJornada.length) * 100)}% da meta de FP para todos` : ''} />
        <Placar rotulo="Pedem ação hoje" valor={hoje.length} tom={hoje.length ? 'text-red-600' : 'text-navy-500'} />
        <Placar rotulo="Diagnósticos sem vínculo" valor={dados.semVinculo.length}
          tom={dados.semVinculo.length ? 'text-accent-600' : 'text-navy-500'} />
      </div>

      {/* Diagnósticos que a automação não conseguiu ligar a um contato */}
      {dados.semVinculo.length > 0 && (
        <SemVinculo diags={dados.semVinculo} clientes={dados.clientes} onFeito={recarregar} />
      )}

      {/* Hoje */}
      <section className="bg-white rounded-xl border border-gray-100 shadow-sm">
        <header className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
          <CalendarClock size={16} className="text-accent-500" />
          <h3 className="text-sm font-semibold text-navy-500">Hoje</h3>
          <span className="text-xs text-gray-400">o que pede ação, do mais urgente para o menos</span>
        </header>
        {hoje.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-400 text-center">Nada atrasado. Bom sinal.</p>
        ) : (
          <ul className="divide-y divide-gray-50">
            {hoje.map(c => (
              <li key={c.id}>
                <button onClick={() => setAberto(c.id)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 text-left">
                  <span className="font-medium text-sm text-gray-900 truncate flex-1 min-w-0">{c.name}</span>
                  <span className="hidden sm:inline text-xs text-gray-400 whitespace-nowrap">
                    {ETAPAS.find(e => e.key === c.etapa).label}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded whitespace-nowrap ${TONS_ALERTA[c.alertas[0].urg]}`}>
                    {c.alertas[0].texto}
                  </span>
                  <ChevronRight size={14} className="text-gray-300 shrink-0" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Quadro */}
      <section>
        <div className="flex flex-col sm:flex-row gap-3 mb-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={busca} onChange={e => setBusca(e.target.value)}
              placeholder="Buscar cliente na jornada..."
              className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-accent-500 focus:border-transparent outline-none" />
          </div>
          <button onClick={() => setAdicionando(true)} className="btn-secondary text-xs gap-1.5 whitespace-nowrap">
            <Plus size={14} /> Adicionar cliente
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {ETAPAS.map(et => (
            <div key={et.key} className={`bg-gray-50 rounded-xl border border-gray-100 border-t-4 ${TONS_ETAPA[et.key]} flex flex-col`}>
              <div className="px-3 pt-3 pb-2">
                <div className="flex items-baseline justify-between">
                  <h4 className="text-sm font-semibold text-navy-500">{et.label}</h4>
                  <span className="text-xs text-gray-400">{porEtapa[et.key].length}</span>
                </div>
                <p className="text-xs text-gray-400">{et.hint}</p>
              </div>
              <div className="px-2 pb-2 space-y-2 max-h-[60vh] overflow-y-auto">
                {porEtapa[et.key].length === 0 && (
                  <p className="text-xs text-gray-300 text-center py-4">Ninguém aqui</p>
                )}
                {porEtapa[et.key].map(c => <Card key={c.id} c={c} onClick={() => setAberto(c.id)} />)}
              </div>
            </div>
          ))}
        </div>
      </section>

      {clienteAberto && (
        <Ficha
          c={clienteAberto}
          cadencia={dados.cadencia}
          teamId={team.id}
          userId={user.id}
          onClose={() => setAberto(null)}
          onSalvo={recarregar}
          onAbrirCompleto={() => { setAberto(null); onAbrirCompleto(clienteAberto) }}
        />
      )}

      {adicionando && (
        <Adicionar
          clientes={dados.clientes.filter(c => !c.naJornada)}
          onClose={() => setAdicionando(false)}
          onEscolher={async (c) => {
            try {
              await setNaJornada(team.id, c.id, true, user.id)
              toast.success(`${c.name} entrou na jornada`)
              setAdicionando(false)
              recarregar()
            } catch (err) { toast.error('Erro: ' + err.message) }
          }}
        />
      )}
    </div>
  )
}

function Placar({ rotulo, valor, detalhe, tom = 'text-navy-500' }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3">
      <p className="text-xs text-gray-400">{rotulo}</p>
      <p className={`text-2xl font-display font-bold mt-0.5 ${tom}`}>{valor}</p>
      {detalhe && <p className="text-xs text-gray-400 mt-0.5">{detalhe}</p>}
    </div>
  )
}

function Card({ c, onClick }) {
  const alerta = c.alertas[0]
  const passo = c.perfil?.proximo_passo
  return (
    <button onClick={onClick}
      className="w-full text-left bg-white rounded-lg border border-gray-100 shadow-sm px-3 py-2.5 hover:border-accent-300 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium text-gray-900 leading-snug">{c.name}</span>
        {c.tier && <span className="text-[10px] font-bold text-navy-400 bg-navy-50 rounded px-1.5 py-0.5 shrink-0">{c.tier}</span>}
      </div>
      {passo && (
        <p className="text-xs text-gray-600 mt-1 line-clamp-2">
          {passo}{c.perfil?.proximo_passo_data && <span className="text-gray-400"> · {formatDate(c.perfil.proximo_passo_data)}</span>}
        </p>
      )}
      {c.etapa === 'implantacao' && c.combinados.length > 0 && (
        <p className="text-xs text-gray-400 mt-1">
          {c.combinados.length - c.pendentes.length} de {c.combinados.length} combinados feitos
        </p>
      )}
      <div className="flex items-center justify-between gap-2 mt-2">
        <span className="text-[11px] text-gray-400">Contato {rotuloDias(c.diasSemContato)}</span>
        {alerta && alerta.urg >= 2 && (
          <span className={`text-[11px] px-1.5 py-0.5 rounded ${TONS_ALERTA[alerta.urg]}`}>{alerta.texto}</span>
        )}
      </div>
    </button>
  )
}

function SemVinculo({ diags, clientes, onFeito }) {
  const [escolha, setEscolha] = useState({})
  async function vincular(d) {
    const cid = escolha[d.id]
    if (!cid) return toast.error('Escolha o contato primeiro')
    try {
      await vincularDiagnostico(d.id, cid)
      toast.success('Diagnóstico vinculado')
      onFeito()
    } catch (err) { toast.error('Erro: ' + err.message) }
  }
  const primeiroNome = (n) => (n || '').split(' ')[0].toLowerCase()
  return (
    <section className="bg-accent-50 border border-accent-200 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-1">
        <Link2 size={16} className="text-accent-600" />
        <h3 className="text-sm font-semibold text-navy-500">Diagnósticos para vincular</h3>
      </div>
      <p className="text-xs text-gray-500 mb-3">
        A automação não teve certeza de qual contato é o cliente. Escolha uma vez; os próximos diagnósticos dele já entram sozinhos.
      </p>
      <ul className="space-y-2">
        {diags.map(d => {
          const sugeridos = clientes.filter(c => c.name?.toLowerCase().startsWith(primeiroNome(d.cliente_nome)))
          const outros = clientes.filter(c => !sugeridos.includes(c))
          return (
            <li key={d.id} className="flex flex-col sm:flex-row sm:items-center gap-2 bg-white rounded-lg px-3 py-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900">{d.cliente_nome}</p>
                <p className="text-xs text-gray-400">{d.tipo} · {formatDate(d.data_reuniao)}</p>
              </div>
              <select value={escolha[d.id] || ''} onChange={e => setEscolha({ ...escolha, [d.id]: e.target.value })}
                className="px-2 py-1.5 border border-gray-200 rounded-lg text-sm max-w-xs">
                <option value="">Qual contato?</option>
                {sugeridos.length > 0 && (
                  <optgroup label="Nomes parecidos">
                    {sugeridos.map(c => <option key={c.id} value={c.id}>{c.name} · {c.client_code}</option>)}
                  </optgroup>
                )}
                <optgroup label="Todos">
                  {outros.map(c => <option key={c.id} value={c.id}>{c.name} · {c.client_code}</option>)}
                </optgroup>
              </select>
              <button onClick={() => vincular(d)} className="btn-primary text-xs">Vincular</button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function Adicionar({ clientes, onClose, onEscolher }) {
  const [q, setQ] = useState('')
  const lista = clientes.filter(c => !q || c.name?.toLowerCase().includes(q.toLowerCase()) || c.client_code?.includes(q)).slice(0, 50)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md max-h-[80vh] flex flex-col">
        <header className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-semibold text-navy-500">Adicionar à jornada</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </header>
        <div className="p-4">
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Nome ou código"
            className="input" />
        </div>
        <ul className="overflow-y-auto px-2 pb-3">
          {lista.map(c => (
            <li key={c.id}>
              <button onClick={() => onEscolher(c)} className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 text-sm">
                {c.name} <span className="text-xs text-gray-400 font-mono">{c.client_code}</span>
              </button>
            </li>
          ))}
          {lista.length === 0 && <p className="text-sm text-gray-400 text-center py-4">Ninguém encontrado</p>}
        </ul>
      </div>
    </div>
  )
}

/** Painel lateral do cliente na jornada. */
function Ficha({ c, cadencia, teamId, userId, onClose, onSalvo, onAbrirCompleto }) {
  const [passo, setPasso] = useState(c.perfil?.proximo_passo || '')
  const [passoData, setPassoData] = useState(c.perfil?.proximo_passo_data || '')
  const [tier, setTier] = useState(c.tier || '')
  const [salvando, setSalvando] = useState(false)
  const [novoComb, setNovoComb] = useState('')
  const [dataEntrega, setDataEntrega] = useState(hojeISO())
  const [subindo, setSubindo] = useState(false)
  const [sugestoes, setSugestoes] = useState(null)
  const arquivoRef = useRef(null)
  const etapa = ETAPAS.find(e => e.key === c.etapa)
  const pasta = c.perfil?.pasta_drive_url || c.diag?.pasta_url

  async function salvarPasso() {
    setSalvando(true)
    try {
      await salvarPerfilJornada(teamId, c.id, {
        proximo_passo: passo.trim() || null,
        proximo_passo_data: passoData || null,
        tier: tier || null,
      }, userId)
      toast.success('Salvo')
      onSalvo()
    } catch (err) { toast.error('Erro: ' + err.message) } finally { setSalvando(false) }
  }

  async function alternarCombinado(i) {
    const lista = c.combinados.map((x, j) => j === i ? { ...x, feito: !x.feito } : x)
    try { await salvarCombinados(c.fp.id, lista); onSalvo() } catch (err) { toast.error('Erro: ' + err.message) }
  }

  async function adicionarCombinados(textos) {
    const novos = textos.map(t => t.trim()).filter(Boolean).map(texto => ({ texto, feito: false }))
    if (!novos.length) return
    try {
      await salvarCombinados(c.fp.id, [...c.combinados, ...novos])
      setNovoComb('')
      onSalvo()
    } catch (err) { toast.error('Erro: ' + err.message) }
  }

  async function enviarFP(e) {
    const arquivo = e.target.files?.[0]
    e.target.value = ''
    if (!arquivo) return
    if (arquivo.type !== 'application/pdf') return toast.error('Envie o PDF do FP')
    setSubindo(true)
    try {
      const ciclo = await subirFP(teamId, c, arquivo, dataEntrega, cadencia, userId)
      toast.success('FP registrado como entregue')
      onSalvo()
      // Leitura do PDF e cópia no Drive: em segundo plano, sem travar a tela.
      processarFP(teamId, ciclo.id)
        .then(r => {
          if (r?.combinados?.length) setSugestoes(r.combinados)
          if (r?.drive?.ok) toast.success('Cópia salva na pasta do cliente no Drive')
          else if (r?.drive?.motivo) toast(r.drive.motivo, { icon: 'ℹ️' })
          onSalvo()
        })
        .catch(() => toast('Não consegui ler o PDF agora; cadastre os combinados à mão.', { icon: 'ℹ️' }))
    } catch (err) {
      toast.error('Erro ao subir o FP: ' + err.message)
    } finally { setSubindo(false) }
  }

  async function tirarDaJornada() {
    if (!confirm(`Tirar ${c.name} da jornada? Nada é apagado; ele só sai do quadro.`)) return
    try { await setNaJornada(teamId, c.id, false, userId); onClose(); onSalvo() } catch (err) { toast.error(err.message) }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <aside className="relative bg-white w-full max-w-lg h-full shadow-xl flex flex-col">
        <header className="px-6 py-4 border-b border-gray-100 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display font-semibold text-navy-500 truncate">{c.name}</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              <span className="font-mono">{c.client_code || 'sem código'}</span> · {etapa.label} · contato {rotuloDias(c.diasSemContato)}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 shrink-0"><X size={20} /></button>
        </header>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {c.alertas.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {c.alertas.map((a, i) => (
                <span key={i} className={`text-xs px-2 py-0.5 rounded ${TONS_ALERTA[a.urg]}`}>{a.texto}</span>
              ))}
            </div>
          )}

          {/* Próximo passo */}
          <Bloco titulo="Próximo passo">
            <input value={passo} onChange={e => setPasso(e.target.value)}
              placeholder="Ex.: ligar para marcar a apresentação do FP" className="input" />
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-gray-500">Quando
                <input type="date" value={passoData} onChange={e => setPassoData(e.target.value)} className="input mt-1" />
              </label>
              <label className="text-xs text-gray-500">Tier (cadência de contato)
                <select value={tier} onChange={e => setTier(e.target.value)} className="input mt-1">
                  <option value="">Sem tier (90 dias)</option>
                  {['A', 'B', 'C', 'D'].map(t => (
                    <option key={t} value={t}>{t} · contato a cada {cadencia[t][0]} dias</option>
                  ))}
                </select>
              </label>
            </div>
            <button onClick={salvarPasso} disabled={salvando} className="btn-primary text-xs">
              {salvando ? 'Salvando...' : 'Salvar'}
            </button>
          </Bloco>

          {/* Diagnóstico */}
          <Bloco titulo="Diagnóstico 360">
            {c.diags.length === 0 ? (
              <p className="text-sm text-gray-400">
                Nenhum ainda. Ele aparece aqui sozinho na manhã seguinte à reunião gravada no Meet.
              </p>
            ) : (
              <ul className="space-y-2">
                {c.diags.map(d => (
                  <li key={d.id} className="text-sm bg-gray-50 rounded-lg px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-gray-800">{formatDate(d.data_reuniao)} · {d.tipo}</span>
                    </div>
                    {d.numero_central && <p className="text-xs text-gray-500 mt-0.5">{d.numero_central}</p>}
                    {d.meta && <p className="text-xs text-gray-500">Meta: {d.meta}</p>}
                    <div className="flex flex-wrap gap-3 mt-1.5">
                      {d.diagnostico_url && <Link href={d.diagnostico_url} icon={FileText}>Diagnóstico</Link>}
                      {d.briefing_url && <Link href={d.briefing_url} icon={FileText}>Briefing</Link>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {pasta && <Link href={pasta} icon={FolderOpen}>Pasta do cliente no Drive</Link>}
          </Bloco>

          {/* FP */}
          <Bloco titulo="Financial Planning">
            {c.fp ? (
              <div className="text-sm bg-gray-50 rounded-lg px-3 py-2 space-y-1">
                <p className="text-gray-800">
                  Entregue em <b>{formatDate(c.fp.completed_at)}</b>
                  {c.fp.next_fp_date && <span className="text-gray-500"> · revisão em {formatDate(c.fp.next_fp_date)}</span>}
                </p>
                <div className="flex flex-wrap gap-3">
                  {c.fp.pdf_path && (
                    <button onClick={() => abrirPDF(c.fp.pdf_path).catch(e => toast.error(e.message))}
                      className="text-xs text-accent-600 hover:underline inline-flex items-center gap-1">
                      <FileText size={12} /> {c.fp.pdf_nome || 'PDF do FP'}
                    </button>
                  )}
                  {c.fp.pdf_drive_url && <Link href={c.fp.pdf_drive_url} icon={ExternalLink}>Cópia no Drive</Link>}
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-400">Ainda não entregue.</p>
            )}

            <div className="flex flex-col sm:flex-row sm:items-end gap-2">
              <label className="text-xs text-gray-500">Data da entrega
                <input type="date" value={dataEntrega} onChange={e => setDataEntrega(e.target.value)} className="input mt-1" />
              </label>
              <input ref={arquivoRef} type="file" accept="application/pdf" className="hidden" onChange={enviarFP} />
              <button onClick={() => arquivoRef.current?.click()} disabled={subindo} className="btn-secondary text-xs gap-1.5">
                <Upload size={14} /> {subindo ? 'Subindo...' : c.fp ? 'Subir FP novo (revisão)' : 'Subir PDF do FP'}
              </button>
            </div>
            <p className="text-xs text-gray-400">
              Ao subir: o FP fica como entregue, a revisão é agendada pela cadência do tier, o PDF é lido para sugerir os combinados e uma cópia vai para a pasta do cliente no Drive.
            </p>
          </Bloco>

          {/* Combinados */}
          {c.fp && (
            <Bloco titulo={`Combinados do FP (${c.combinados.length - c.pendentes.length} de ${c.combinados.length} feitos)`}>
              {sugestoes?.length > 0 && (
                <div className="bg-navy-50 rounded-lg p-3 space-y-2">
                  <p className="text-xs font-medium text-navy-500 flex items-center gap-1">
                    <Sparkles size={13} /> Combinados que encontrei no PDF
                  </p>
                  <ul className="text-sm text-gray-700 list-disc pl-5 space-y-0.5">
                    {sugestoes.map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                  <div className="flex gap-2">
                    <button onClick={() => { adicionarCombinados(sugestoes); setSugestoes(null) }} className="btn-primary text-xs">
                      Adicionar todos
                    </button>
                    <button onClick={() => setSugestoes(null)} className="btn-secondary text-xs">Descartar</button>
                  </div>
                </div>
              )}
              {c.combinados.length === 0 && !sugestoes && (
                <p className="text-sm text-gray-400">Nenhum combinado cadastrado.</p>
              )}
              <ul className="space-y-1">
                {c.combinados.map((x, i) => (
                  <li key={i}>
                    <button onClick={() => alternarCombinado(i)}
                      className="w-full flex items-start gap-2 text-left text-sm px-2 py-1.5 rounded hover:bg-gray-50">
                      {x.feito
                        ? <CheckCircle2 size={16} className="text-emerald-600 shrink-0 mt-0.5" />
                        : <Circle size={16} className="text-gray-300 shrink-0 mt-0.5" />}
                      <span className={x.feito ? 'text-gray-400 line-through' : 'text-gray-800'}>{x.texto}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <input value={novoComb} onChange={e => setNovoComb(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') adicionarCombinados([novoComb]) }}
                  placeholder="Novo combinado" className="input" />
                <button onClick={() => adicionarCombinados([novoComb])} className="btn-secondary text-xs">Adicionar</button>
              </div>
              <p className="text-xs text-gray-400">
                Quando todos estiverem feitos, o cliente passa para "Em acompanhamento".
              </p>
            </Bloco>
          )}

          <div className="pt-2 border-t border-gray-100 flex flex-wrap gap-4">
            <button onClick={onAbrirCompleto} className="text-xs text-accent-600 hover:underline">
              Produtos, relacionamento e lembretes
            </button>
            <button onClick={tirarDaJornada} className="text-xs text-gray-400 hover:text-red-600 inline-flex items-center gap-1">
              <UserMinus size={12} /> Tirar da jornada
            </button>
          </div>
        </div>
      </aside>
    </div>
  )
}

function Bloco({ titulo, children }) {
  return (
    <section className="space-y-3">
      <h4 className="text-sm font-semibold text-navy-500">{titulo}</h4>
      {children}
    </section>
  )
}

function Link({ href, icon: Icon, children }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className="text-xs text-accent-600 hover:underline inline-flex items-center gap-1">
      <Icon size={12} /> {children}
    </a>
  )
}

