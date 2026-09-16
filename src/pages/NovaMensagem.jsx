import { useState, useEffect, useRef, useMemo } from 'react'
import {
  Send, Sparkles, Upload, FileText, AlertCircle, AlertTriangle, Users, Building2,
  Search, Save, FolderOpen, Plus, Check, ChevronLeft, Eye, Trash2, User,
  CalendarClock, BookmarkPlus, History,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '../hooks/useAuth'
import {
  getContacts, getPDFs, uploadPDFsBulk, extractClientCode, getClientGroups,
  gerarParaDestinatarios, aplicarNome,
  getDrafts, saveDraft, deleteDraft, markDraftSent,
  enfileirarMensagens, getPromptTemplates, savePromptTemplate,
  getUltimoContato, diasDesde,
} from '../lib/api'
import { montarDestinatarios, avisosDoDestinatario, temErroBloqueante } from '../lib/destinatarios'
import { formatarTelefone } from '../lib/format'
import GrupoModal from '../components/GrupoModal'

const ETAPAS = [
  { n: 1, titulo: 'Destinatários' },
  { n: 2, titulo: 'Mensagem' },
  { n: 3, titulo: 'Revisar e enviar' },
]

export default function NovaMensagem() {
  const { user, team } = useAuth()

  const [etapa, setEtapa] = useState(1)
  const [contacts, setContacts] = useState([])
  const [pdfs, setPdfs] = useState([])
  const [groups, setGroups] = useState([])
  const [drafts, setDrafts] = useState([])

  const [selecionados, setSelecionados] = useState(new Set())
  const [busca, setBusca] = useState('')
  const [prompt, setPrompt] = useState('')
  const [itens, setItens] = useState([])          // { destinatarioId, message, status, error }
  const [rascunhoId, setRascunhoId] = useState(null)
  const [rascunhoNome, setRascunhoNome] = useState('')

  const [uploading, setUploading] = useState(false)
  const [uploadProg, setUploadProg] = useState({ done: 0, total: 0 })
  const [gerando, setGerando] = useState(false)
  const [genProg, setGenProg] = useState({ done: 0, total: 0 })
  const [enviando, setEnviando] = useState(false)
  const [salvando, setSalvando] = useState(false)

  const [templates, setTemplates] = useState([])
  const [ultimoContato, setUltimoContato] = useState(new Map())
  const [agendarPara, setAgendarPara] = useState('')

  const [grupoModal, setGrupoModal] = useState(null)   // null | {} | grupo
  const [mostrarRascunhos, setMostrarRascunhos] = useState(false)
  const [preview, setPreview] = useState(null)
  const pdfInputRef = useRef()

  const delay = team?.settings?.delay_between_messages ?? 5

  useEffect(() => { if (team?.id) carregarTudo() }, [team?.id])

  async function carregarTudo() {
    try {
      const [c, p, g, d, t, u] = await Promise.all([
        getContacts(team.id), getPDFs(team.id), getClientGroups(team.id), getDrafts(team.id),
        getPromptTemplates(team.id),
        // Histórico é conveniência: se falhar, a tela continua utilizável.
        getUltimoContato(team.id).catch(() => new Map()),
      ])
      setContacts(c); setPdfs(p); setGroups(g); setDrafts(d); setTemplates(t); setUltimoContato(u)
    } catch (err) {
      toast.error('Erro ao carregar dados: ' + (err.message || ''))
    }
  }

  const destinatarios = useMemo(
    () => montarDestinatarios(contacts, groups, pdfs),
    [contacts, groups, pdfs])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return destinatarios
    return destinatarios.filter(d =>
      d.nome?.toLowerCase().includes(q) ||
      d.telefone?.includes(q) ||
      d.contatos.some(c => c.client_code?.includes(q) || c.name?.toLowerCase().includes(q)))
  }, [destinatarios, busca])

  const escolhidos = useMemo(
    () => destinatarios.filter(d => selecionados.has(d.id)),
    [destinatarios, selecionados])

  const comErro = escolhidos.filter(temErroBloqueante)
  const totalPdfs = escolhidos.reduce((s, d) => s + d.pdfs.length, 0)

  // ==========================================
  // PDFs
  // ==========================================
  async function handlePDFUpload(e) {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return

    const semCodigo = files.filter(f => !extractClientCode(f.name))
    if (semCodigo.length > 0) {
      const nomes = semCodigo.slice(0, 3).map(f => f.name).join(', ')
      toast.error(`${semCodigo.length} arquivo(s) sem código no nome: ${nomes}${semCodigo.length > 3 ? '…' : ''}`)
    }
    const validos = files.filter(f => extractClientCode(f.name))
    if (validos.length === 0) { e.target.value = ''; return }

    setUploading(true); setUploadProg({ done: 0, total: validos.length })
    try {
      const res = await uploadPDFsBulk(team.id, validos, user.id, (done, total) => setUploadProg({ done, total }))
      const ok = res.filter(r => r.status === 'ok').length
      setPdfs(await getPDFs(team.id))
      toast.success(`${ok} PDF(s) enviado(s)`)
    } catch (err) {
      toast.error('Erro no upload: ' + err.message)
    } finally {
      setUploading(false); e.target.value = ''
    }
  }

  // ==========================================
  // Seleção
  // ==========================================
  function alternar(id) {
    setSelecionados(prev => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }
  const selecionarComPdf = () => setSelecionados(new Set(filtrados.filter(d => d.pdfs.length > 0).map(d => d.id)))
  const selecionarTodos = () => setSelecionados(new Set(filtrados.map(d => d.id)))
  const limparSelecao = () => setSelecionados(new Set())

  // ==========================================
  // Geração
  // ==========================================
  async function gerar() {
    if (!prompt.trim()) return toast.error('Escreva a instrução para a IA')
    if (escolhidos.length === 0) return toast.error('Selecione ao menos um destinatário')

    setGerando(true); setGenProg({ done: 0, total: escolhidos.length })
    try {
      const res = await gerarParaDestinatarios(prompt, escolhidos, team.id,
        (done, total) => setGenProg({ done, total }))
      setItens(res)
      const ok = res.filter(r => r.status === 'gerada').length
      const falhas = res.length - ok
      if (ok > 0) toast.success(`${ok} mensagem(ns) gerada(s)`)
      if (falhas > 0) toast.error(`${falhas} falhou(aram) — veja na revisão`)
      setEtapa(3)
    } catch (err) {
      toast.error('Erro na geração: ' + (err.message || ''))
    } finally {
      setGerando(false)
    }
  }

  function editarMensagem(destinatarioId, texto) {
    setItens(prev => prev.map(i => i.destinatarioId === destinatarioId ? { ...i, message: texto } : i))
  }

  function removerItem(destinatarioId) {
    setItens(prev => prev.filter(i => i.destinatarioId !== destinatarioId))
    setSelecionados(prev => {
      const n = new Set(prev); n.delete(destinatarioId); return n
    })
  }

  // ==========================================
  // Rascunhos
  // ==========================================
  async function salvarRascunho() {
    const prontos = itens.filter(i => i.status === 'gerada' && i.message.trim())
    if (prontos.length === 0) return toast.error('Nada para salvar')

    const nome = rascunhoNome.trim() ||
      `Rascunho de ${new Date().toLocaleDateString('pt-BR')} (${prontos.length} msg)`

    setSalvando(true)
    try {
      const payload = prontos.map(i => {
        const d = destinatarios.find(x => x.id === i.destinatarioId)
        return {
          destinatario_id: i.destinatarioId,
          name: d?.nome || '',
          phone: d?.telefone || '',
          message: i.message,
          pdf_ids: (d?.pdfs || []).map(p => p.id),
        }
      })
      const salvo = await saveDraft(team.id, { id: rascunhoId, name: nome, prompt, items: payload }, user.id)
      setRascunhoId(salvo.id); setRascunhoNome(salvo.name)
      setDrafts(await getDrafts(team.id))
      toast.success('Rascunho salvo')
    } catch (err) {
      toast.error('Erro ao salvar rascunho: ' + (err.message || ''))
    } finally {
      setSalvando(false)
    }
  }

  function carregarRascunho(d) {
    const ids = (d.items || []).map(i => i.destinatario_id).filter(Boolean)
    setSelecionados(new Set(ids))
    setItens((d.items || []).map(i => ({
      destinatarioId: i.destinatario_id, message: i.message, status: 'gerada',
    })))
    setPrompt(d.prompt || '')
    setRascunhoId(d.id); setRascunhoNome(d.name)
    setMostrarRascunhos(false); setEtapa(3)
    toast.success(`Rascunho "${d.name}" carregado`)
  }

  async function excluirRascunho(id, e) {
    e.stopPropagation()
    if (!confirm('Excluir este rascunho?')) return
    try {
      await deleteDraft(id)
      setDrafts(await getDrafts(team.id))
      if (rascunhoId === id) { setRascunhoId(null); setRascunhoNome('') }
      toast.success('Rascunho excluído')
    } catch { toast.error('Erro ao excluir') }
  }

  // ==========================================
  // Envio
  // ==========================================
  async function enviar() {
    const prontos = itens.filter(i => i.status === 'gerada' && i.message.trim())
    if (prontos.length === 0) return toast.error('Nenhuma mensagem para enviar')

    const bloqueados = prontos.filter(i => {
      const d = destinatarios.find(x => x.id === i.destinatarioId)
      return d && temErroBloqueante(d)
    })
    if (bloqueados.length > 0) {
      return toast.error(`${bloqueados.length} destinatário(s) com pendência. Resolva ou remova antes de enviar.`)
    }

    // Agendamento: o input datetime-local vem no fuso local; toISOString
    // converte para UTC, que é o que a fila compara.
    let quando = null
    if (agendarPara) {
      const data = new Date(agendarPara)
      if (isNaN(data.getTime())) return toast.error('Data de agendamento inválida')
      if (data.getTime() < Date.now()) return toast.error('A data de agendamento já passou')
      quando = data.toISOString()
    }

    const lista = prontos.map(i => destinatarios.find(x => x.id === i.destinatarioId)?.nome).filter(Boolean)
    const amostra = lista.slice(0, 5).join('\n• ')
    const resto = lista.length > 5 ? `\n… e mais ${lista.length - 5}` : ''
    const quandoTexto = quando
      ? `agendar para ${new Date(agendarPara).toLocaleString('pt-BR')}`
      : 'enviar agora'
    if (!confirm(`Vamos ${quandoTexto}:\n\n${prontos.length} mensagem(ns) para:\n• ${amostra}${resto}\n\nConfirma?`)) return

    const destinos = prontos.map(i => {
      const d = destinatarios.find(x => x.id === i.destinatarioId)
      return {
        phone: d.telefone,
        name: d.titular,
        message: i.message,
        pdfs: d.pdfs,
        contactId: d.tipo === 'contato' ? d.contatoId : (d.contatos[0]?.id || null),
      }
    })

    setEnviando(true)
    try {
      const r = await enfileirarMensagens(team.id, destinos, {
        nome: rascunhoNome.trim() || undefined,
        scheduledAt: quando,
        delaySeconds: delay,
      })

      toast.success(quando
        ? `${r.mensagens} mensagem(ns) agendadas`
        : `${r.mensagens} mensagem(ns) na fila — saindo agora`)

      if (rascunhoId) await markDraftSent(rascunhoId)
      setItens([]); setSelecionados(new Set()); setPrompt('')
      setRascunhoId(null); setRascunhoNome(''); setAgendarPara('')
      setDrafts(await getDrafts(team.id))
      setEtapa(1)
    } catch (err) {
      toast.error('Erro ao enfileirar: ' + (err.message || ''))
    } finally {
      setEnviando(false)
    }
  }

  // ==========================================
  // Templates de instrução
  // ==========================================
  async function salvarTemplate() {
    if (!prompt.trim()) return toast.error('Escreva a instrução primeiro')
    const nome = window.prompt('Nome do template:')
    if (!nome?.trim()) return
    try {
      await savePromptTemplate(team.id, nome.trim(), prompt.trim(), user.id)
      setTemplates(await getPromptTemplates(team.id))
      toast.success('Template salvo')
    } catch (err) {
      toast.error('Erro ao salvar template: ' + (err.message || ''))
    }
  }

  const prontosCount = itens.filter(i => i.status === 'gerada' && i.message.trim()).length

  return (
    <div className="max-w-5xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h2 className="text-2xl font-display font-bold text-navy-500">Nova Mensagem</h2>
          <p className="text-sm text-gray-400 mt-0.5">
            {destinatarios.length} destinatário(s) · {pdfs.length} PDF(s) na biblioteca
          </p>
        </div>
        <button onClick={() => setMostrarRascunhos(v => !v)} className="btn-secondary text-xs gap-1.5">
          <FolderOpen size={14} /> Rascunhos ({drafts.length})
        </button>
      </div>

      {mostrarRascunhos && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 mb-6">
          {drafts.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">
              Nenhum rascunho salvo. Na etapa de revisão você pode salvar as mensagens para continuar depois.
            </p>
          ) : (
            <ul className="divide-y divide-gray-50">
              {drafts.map(d => (
                <li key={d.id}>
                  <button onClick={() => carregarRascunho(d)}
                    className="w-full flex items-center justify-between gap-3 py-3 px-2 hover:bg-gray-50 rounded-lg text-left">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{d.name}</p>
                      <p className="text-xs text-gray-400">
                        {(d.items || []).length} mensagem(ns) ·{' '}
                        {new Date(d.updated_at).toLocaleString('pt-BR')}
                        {d.sent_at && <span className="text-emerald-600 ml-2">· já enviado</span>}
                      </p>
                    </div>
                    <span onClick={e => excluirRascunho(d.id, e)}
                      className="text-gray-300 hover:text-red-500 p-1 shrink-0"><Trash2 size={15} /></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Passos */}
      <nav className="flex items-center gap-2 mb-6">
        {ETAPAS.map((e, idx) => {
          const ativa = etapa === e.n
          const concluida = etapa > e.n
          const podeIr = e.n === 1 || (e.n === 2 && escolhidos.length > 0) || (e.n === 3 && itens.length > 0)
          return (
            <div key={e.n} className="flex items-center gap-2">
              <button
                onClick={() => podeIr && setEtapa(e.n)}
                disabled={!podeIr}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  ativa ? 'bg-navy-500 text-white'
                    : concluida ? 'bg-navy-50 text-navy-500 hover:bg-navy-100'
                    : 'text-gray-400'} ${!podeIr ? 'cursor-not-allowed' : ''}`}>
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${
                  ativa ? 'bg-white/20' : concluida ? 'bg-navy-500 text-white' : 'bg-gray-100'}`}>
                  {concluida ? <Check size={12} /> : e.n}
                </span>
                <span className="hidden sm:inline">{e.titulo}</span>
              </button>
              {idx < ETAPAS.length - 1 && <div className="w-4 h-px bg-gray-200" />}
            </div>
          )
        })}
      </nav>

      {/* ETAPA 1 — DESTINATÁRIOS */}
      {etapa === 1 && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="font-display font-semibold text-navy-500 flex items-center gap-2">
                  <FileText size={18} /> PDFs dos clientes
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  O código é lido do nome do arquivo — ex.: "Conta 355986.pdf"
                </p>
              </div>
              <button onClick={() => pdfInputRef.current?.click()} disabled={uploading}
                className="btn-secondary gap-1.5 shrink-0">
                {uploading
                  ? <><div className="animate-spin w-4 h-4 border-2 border-navy-500 border-t-transparent rounded-full" /> {uploadProg.done}/{uploadProg.total}</>
                  : <><Upload size={16} /> Importar PDFs</>}
              </button>
              <input ref={pdfInputRef} type="file" accept=".pdf" multiple
                onChange={handlePDFUpload} className="hidden" />
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <h3 className="font-display font-semibold text-navy-500">Para quem vai</h3>
              <button onClick={() => setGrupoModal({})} className="btn-secondary text-xs gap-1.5">
                <Plus size={14} /> Novo grupo
              </button>
            </div>

            <div className="relative mb-3">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={busca} onChange={e => setBusca(e.target.value)}
                placeholder="Buscar por nome, código ou telefone..." className="input pl-9" />
            </div>

            <div className="flex items-center justify-between mb-3 text-xs">
              <div className="flex gap-2">
                <button onClick={selecionarComPdf} className="text-accent-600 hover:underline">Com PDF</button>
                <span className="text-gray-300">|</span>
                <button onClick={selecionarTodos} className="text-accent-600 hover:underline">Todos</button>
                <span className="text-gray-300">|</span>
                <button onClick={limparSelecao} className="text-gray-400 hover:underline">Limpar</button>
              </div>
              <span className="text-gray-400">
                {selecionados.size} selecionado(s) · {totalPdfs} PDF(s)
              </span>
            </div>

            <div className="border border-gray-100 rounded-lg divide-y divide-gray-50 max-h-[30rem] overflow-auto">
              {filtrados.length === 0 && (
                <p className="p-8 text-center text-sm text-gray-400">Nenhum destinatário encontrado.</p>
              )}
              {filtrados.map(d => {
                const marcado = selecionados.has(d.id)
                const avisos = avisosDoDestinatario(d)
                const bloqueado = avisos.some(a => a.nivel === 'erro')
                return (
                  <div key={d.id} className={`px-3 py-3 ${marcado ? 'bg-accent-50/50' : 'hover:bg-gray-50'}`}>
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input type="checkbox" checked={marcado} onChange={() => alternar(d.id)}
                        className="rounded mt-1" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {d.tipo === 'grupo' && (
                            <span className="flex items-center gap-1 text-xs bg-navy-50 text-navy-500 px-2 py-0.5 rounded">
                              {d.kind === 'empresa' ? <Building2 size={11} /> : <Users size={11} />}
                              {d.contatos.length} contas
                            </span>
                          )}
                          <span className="font-medium text-gray-900">{d.nome}</span>
                          {d.pdfs.length > 0 && (
                            <span className="text-xs text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
                              {d.pdfs.length} PDF{d.pdfs.length > 1 ? 's' : ''}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">
                          <span className="font-mono">{formatarTelefone(d.telefone)}</span>
                          {d.tipo === 'grupo'
                            ? <span className="ml-2">recebe: {d.titular}</span>
                            : d.clientCode && <span className="text-navy-400 ml-2">#{d.clientCode}</span>}
                        </p>
                        {avisos.map((a, i) => (
                          <p key={i} className={`text-xs mt-1 flex items-start gap-1 ${
                            a.nivel === 'erro' ? 'text-red-600' : 'text-amber-600'}`}>
                            <AlertTriangle size={12} className="shrink-0 mt-0.5" /> {a.texto}
                          </p>
                        ))}
                      </div>
                      {d.tipo === 'grupo' && (
                        <button onClick={e => { e.preventDefault(); setGrupoModal(groups.find(g => g.id === d.grupoId)) }}
                          className="text-xs text-accent-600 hover:underline shrink-0">editar</button>
                      )}
                    </label>
                  </div>
                )
              })}
            </div>

            <div className="flex items-center justify-between mt-4">
              <p className="text-xs text-gray-400">
                {comErro.length > 0
                  ? <span className="text-red-600">{comErro.length} selecionado(s) com pendência</span>
                  : 'Quem está num grupo não aparece separado — ninguém recebe duas vezes.'}
              </p>
              <button onClick={() => setEtapa(2)} disabled={escolhidos.length === 0} className="btn-primary">
                Continuar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ETAPA 2 — MENSAGEM */}
      {etapa === 2 && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-4">
          <div>
            <h3 className="font-display font-semibold text-navy-500 flex items-center gap-2">
              <Sparkles size={18} /> Instrução para a IA
            </h3>
            <p className="text-xs text-gray-400 mt-1">
              Vai gerar {escolhidos.length} mensagem(ns). Use <code>{'{{nome}}'}</code> onde o nome deve aparecer.
            </p>
          </div>

          {templates.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-gray-400">Usar template:</span>
              {templates.map(t => (
                <button key={t.id} onClick={() => setPrompt(t.content)}
                  className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 text-navy-500 hover:bg-gray-50">
                  {t.name}
                </button>
              ))}
            </div>
          )}

          <textarea value={prompt} onChange={e => setPrompt(e.target.value)}
            placeholder={'Ex.: Gere uma mensagem curta informando a rentabilidade do mês e do ano, com base no PDF do cliente. Tom direto, sem jargão.'}
            className="input min-h-[10rem] leading-relaxed" />

          <button onClick={salvarTemplate} disabled={!prompt.trim()}
            className="text-xs text-accent-600 hover:underline flex items-center gap-1 disabled:opacity-40">
            <BookmarkPlus size={13} /> Salvar esta instrução como template
          </button>

          {escolhidos.some(d => d.tipo === 'grupo') && (
            <div className="flex gap-2 p-3 bg-navy-50/60 rounded-lg text-xs text-navy-500">
              <AlertCircle size={15} className="shrink-0 mt-0.5" />
              <span>
                Para grupos, a IA escreve um texto <strong>sem números específicos</strong> e os PDFs de
                todas as contas vão anexados. É proposital: a IA lê um PDF por vez, e citar a
                rentabilidade de uma conta só para quem administra várias seria informação errada.
              </span>
            </div>
          )}

          {escolhidos.filter(d => d.pdfs.length === 0).length > 0 && (
            <div className="flex gap-2 p-3 bg-amber-50 rounded-lg text-xs text-amber-700">
              <AlertTriangle size={15} className="shrink-0 mt-0.5" />
              <span>
                {escolhidos.filter(d => d.pdfs.length === 0).length} destinatário(s) sem PDF.
                A mensagem sai genérica, sem dados da carteira.
              </span>
            </div>
          )}

          <div className="flex items-center justify-between pt-1">
            <button onClick={() => setEtapa(1)} className="btn-secondary gap-1.5">
              <ChevronLeft size={16} /> Voltar
            </button>
            <button onClick={gerar} disabled={gerando || !prompt.trim()} className="btn-primary gap-1.5">
              {gerando
                ? <><div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" /> Gerando {genProg.done}/{genProg.total}...</>
                : <><Sparkles size={16} /> Gerar {escolhidos.length} mensagem(ns)</>}
            </button>
          </div>
        </div>
      )}

      {/* ETAPA 3 — REVISAR E ENVIAR */}
      {etapa === 3 && (
        // pb-28: a barra de envio é sticky e cobriria o último cartão sem isso.
        <div className="space-y-4 pb-28">
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex flex-col sm:flex-row sm:items-center gap-3">
            <input value={rascunhoNome} onChange={e => setRascunhoNome(e.target.value)}
              placeholder="Nome deste lote (opcional)" className="input flex-1" />
            <button onClick={salvarRascunho} disabled={salvando || prontosCount === 0}
              className="btn-secondary gap-1.5 shrink-0">
              <Save size={15} /> {salvando ? 'Salvando...' : rascunhoId ? 'Atualizar rascunho' : 'Salvar rascunho'}
            </button>
          </div>

          {itens.map(item => {
            const d = destinatarios.find(x => x.id === item.destinatarioId)
            if (!d) return null
            const avisos = avisosDoDestinatario(d)
            const bloqueado = avisos.some(a => a.nivel === 'erro')
            const textoFinal = aplicarNome(item.message, d.titular)

            return (
              <div key={item.destinatarioId}
                className={`bg-white rounded-xl border shadow-sm overflow-hidden ${
                  bloqueado ? 'border-red-200' : item.status === 'erro' ? 'border-red-200' : 'border-gray-100'}`}>

                {/* Cabeçalho: para quem vai, bem visível */}
                <div className="px-5 py-4 bg-gray-50/70 border-b border-gray-100">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {d.tipo === 'grupo'
                          ? <span className="flex items-center gap-1 text-xs bg-navy-100 text-navy-600 px-2 py-0.5 rounded">
                              {d.kind === 'empresa' ? <Building2 size={11} /> : <Users size={11} />} grupo
                            </span>
                          : <User size={14} className="text-gray-400" />}
                        <h4 className="font-display font-semibold text-navy-500">{d.nome}</h4>
                      </div>
                      <p className="text-sm text-gray-600 mt-1">
                        <span className="font-mono font-medium">{formatarTelefone(d.telefone)}</span>
                        <span className="text-gray-400"> · {d.titular}</span>
                      </p>
                    </div>
                    <button onClick={() => removerItem(item.destinatarioId)}
                      className="text-gray-300 hover:text-red-500 shrink-0" title="Tirar do envio">
                      <Trash2 size={16} />
                    </button>
                  </div>

                  {d.pdfs.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {d.pdfs.map(p => (
                        <span key={p.id}
                          className="flex items-center gap-1 text-xs bg-white border border-gray-200 text-gray-600 px-2 py-1 rounded">
                          <FileText size={11} className="text-emerald-600" />
                          {p.name}
                        </span>
                      ))}
                    </div>
                  )}

                  {avisos.map((a, i) => (
                    <p key={i} className={`text-xs mt-2 flex items-start gap-1 ${
                      a.nivel === 'erro' ? 'text-red-600 font-medium' : 'text-amber-600'}`}>
                      <AlertTriangle size={12} className="shrink-0 mt-0.5" /> {a.texto}
                    </p>
                  ))}

                  {(() => {
                    // Evita dois disparos seguidos para o mesmo cliente sem perceber.
                    const hist = ultimoContato.get(d.telefone)
                    const dias = diasDesde(hist?.ultima)
                    if (dias === null) return null
                    const recente = dias <= 7
                    return (
                      <p className={`text-xs mt-2 flex items-start gap-1 ${
                        recente ? 'text-amber-600' : 'text-gray-400'}`}
                        title={hist.conteudo}>
                        <History size={12} className="shrink-0 mt-0.5" />
                        Última mensagem {dias === 0 ? 'hoje' : `há ${dias} dia(s)`}
                        {recente && ' — pode ser cedo para outro disparo'}
                      </p>
                    )
                  })()}
                </div>

                {/* Editor grande */}
                <div className="p-5">
                  {item.status === 'erro' ? (
                    <p className="text-sm text-red-600">Falha ao gerar: {item.error}</p>
                  ) : (
                    <>
                      <textarea
                        value={item.message}
                        onChange={e => editarMensagem(item.destinatarioId, e.target.value)}
                        className="w-full border border-gray-200 rounded-lg p-4 text-[15px] leading-relaxed
                                   min-h-[12rem] resize-y focus:ring-2 focus:ring-accent-500
                                   focus:border-transparent outline-none"
                      />
                      <div className="flex items-center justify-between mt-2">
                        <span className={`text-xs ${item.message.length > 900 ? 'text-amber-600' : 'text-gray-400'}`}>
                          {item.message.length} caracteres
                          {item.message.includes('{{nome}}') && ' · {{nome}} será trocado no envio'}
                        </span>
                        <button onClick={() => setPreview({ nome: d.nome, telefone: d.telefone, texto: textoFinal, pdfs: d.pdfs })}
                          className="text-xs text-accent-600 hover:underline flex items-center gap-1">
                          <Eye size={13} /> Ver como chega
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )
          })}

          {/* Barra de envio */}
          <div className="sticky bottom-4 bg-white rounded-xl border border-gray-200 shadow-lg p-4
                          flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="text-sm">
              <p className="font-medium text-navy-500">
                {prontosCount} mensagem(ns) prontas
                {totalPdfs > 0 && <span className="text-gray-400 font-normal"> · {totalPdfs} anexo(s)</span>}
              </p>
              <p className="text-xs text-gray-400">
                {agendarPara
                  ? `Agendado para ${new Date(agendarPara).toLocaleString('pt-BR')}`
                  : `Entram na fila e saem com ${delay}s entre cada uma — pode fechar a aba`}
                {comErro.length > 0 && <span className="text-red-600"> · {comErro.length} com pendência</span>}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-gray-500">
                <CalendarClock size={14} className="text-gray-400" />
                <input type="datetime-local" value={agendarPara}
                  onChange={e => setAgendarPara(e.target.value)}
                  className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs outline-none
                             focus:ring-2 focus:ring-accent-500" />
                {agendarPara && (
                  <button onClick={() => setAgendarPara('')}
                    className="text-gray-400 hover:text-gray-600" title="Enviar agora">✕</button>
                )}
              </label>
              <button onClick={() => setEtapa(2)} className="btn-secondary gap-1.5">
                <ChevronLeft size={16} /> Voltar
              </button>
              <button onClick={enviar} disabled={enviando || prontosCount === 0 || comErro.length > 0}
                className="btn-primary gap-1.5">
                {enviando
                  ? <><div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" /> Enfileirando...</>
                  : agendarPara ? <><CalendarClock size={16} /> Agendar</> : <><Send size={16} /> Enviar</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {grupoModal && (
        <GrupoModal
          grupo={grupoModal.id ? grupoModal : null}
          contacts={contacts}
          onClose={() => setGrupoModal(null)}
          onSaved={carregarTudo}
        />
      )}

      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setPreview(null)} />
          <div className="relative bg-[#ECE5DD] rounded-2xl w-full max-w-md shadow-xl overflow-hidden">
            <div className="bg-navy-500 text-white px-4 py-3">
              <p className="font-medium text-sm">{preview.nome}</p>
              <p className="text-xs text-navy-200 font-mono">{formatarTelefone(preview.telefone)}</p>
            </div>
            <div className="p-4 space-y-2 max-h-[60vh] overflow-auto">
              <div className="bg-[#DCF8C6] rounded-lg rounded-tr-none p-3 ml-8 shadow-sm">
                <p className="text-sm whitespace-pre-wrap text-gray-800">{preview.texto}</p>
              </div>
              {preview.pdfs.map(p => (
                <div key={p.id} className="bg-[#DCF8C6] rounded-lg rounded-tr-none p-3 ml-8 shadow-sm flex items-center gap-2">
                  <FileText size={16} className="text-gray-600 shrink-0" />
                  <span className="text-xs text-gray-700 truncate">{p.name}</span>
                </div>
              ))}
            </div>
            <div className="px-4 py-3 bg-white border-t border-gray-100 flex justify-end">
              <button onClick={() => setPreview(null)} className="btn-secondary text-xs">Fechar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
