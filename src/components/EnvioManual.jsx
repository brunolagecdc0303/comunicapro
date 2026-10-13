import { useState, useEffect, useRef } from 'react'
import {
  X, Send, FileText, Check, SkipForward, Copy, Share2, Download, MessageCircle,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { linkWhatsApp, baixarPDFComoArquivo, registrarEnvioManual } from '../lib/api'
import { formatarTelefone } from '../lib/format'

const MODO_KEY = 'comunicapro:modo-whatsapp'

function ehCelular() {
  try { return window.matchMedia('(pointer: coarse)').matches } catch { return false }
}

function lerModo() {
  if (ehCelular()) return 'celular'
  try { return localStorage.getItem(MODO_KEY) || 'web' } catch { return 'web' }
}

function baixar(arquivo) {
  const url = URL.createObjectURL(arquivo)
  const a = document.createElement('a')
  a.href = url
  a.download = arquivo.name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}

/**
 * Envio um a um pelo WhatsApp do próprio assessor.
 *
 * Para cada cliente: abre a conversa com o texto já digitado e, ao mesmo
 * tempo, baixa o PDF — no computador é só arrastar o arquivo para a conversa.
 * No celular o PDF vai pelo menu de compartilhar do sistema.
 *
 * Os PDFs do cliente atual e do próximo são baixados com antecedência: o
 * clique precisa abrir o WhatsApp na hora, senão o navegador bloqueia a janela.
 *
 * itens: [{ id, nome, titular, telefone, texto, pdfs, enviado }]
 */
export default function EnvioManual({ teamId, itens, onMarcado, onClose }) {
  const [modo, setModo] = useState(lerModo)
  const [indice, setIndice] = useState(() => {
    const i = itens.findIndex(x => !x.enviado && !x.pulado)
    return i === -1 ? 0 : i
  })
  const [arquivos, setArquivos] = useState({})   // pdf.id -> File
  const [registrando, setRegistrando] = useState(false)
  const baixando = useRef(new Set())
  const celular = modo === 'celular'

  const atual = itens[indice]
  const enviados = itens.filter(x => x.enviado).length
  const resolvidos = itens.filter(x => x.enviado || x.pulado).length
  const acabou = resolvidos === itens.length

  // Pré-carrega os PDFs do cliente atual e do próximo.
  useEffect(() => {
    for (const item of [itens[indice], itens[indice + 1]]) {
      for (const pdf of item?.pdfs || []) {
        if (arquivos[pdf.id] || baixando.current.has(pdf.id)) continue
        baixando.current.add(pdf.id)
        baixarPDFComoArquivo(pdf)
          .then(f => setArquivos(prev => ({ ...prev, [pdf.id]: f })))
          .catch(err => toast.error(`Erro ao carregar ${pdf.name}: ${err.message || ''}`))
          .finally(() => baixando.current.delete(pdf.id))
      }
    }
  }, [indice, itens])

  function trocarModo(m) {
    setModo(m)
    try { localStorage.setItem(MODO_KEY, m) } catch { /* sem storage: só não lembra */ }
  }

  const arquivosDoAtual = (atual?.pdfs || []).map(p => arquivos[p.id]).filter(Boolean)
  const pdfsProntos = arquivosDoAtual.length === (atual?.pdfs || []).length

  function abrirConversa() {
    const url = linkWhatsApp(atual.telefone, atual.texto, modo)
    // Mesma aba nomeada: o WhatsApp Web não abre uma aba nova a cada cliente.
    if (modo === 'web') window.open(url, 'comunicapro-whatsapp')
    else window.location.href = url

    if (!celular) arquivosDoAtual.forEach(baixar)
  }

  async function compartilharPdf() {
    try {
      await navigator.share({ files: arquivosDoAtual })
    } catch (err) {
      if (err?.name !== 'AbortError') toast.error('Este navegador não conseguiu compartilhar o PDF')
    }
  }

  async function copiarTexto() {
    try {
      await navigator.clipboard.writeText(atual.texto)
      toast.success('Texto copiado')
    } catch { toast.error('Não foi possível copiar') }
  }

  function avancar() {
    const proximo = itens.findIndex((x, i) => i > indice && !x.enviado && !x.pulado)
    if (proximo !== -1) setIndice(proximo)
  }

  async function marcarEnviado() {
    setRegistrando(true)
    try {
      await registrarEnvioManual(teamId, {
        phone: atual.telefone, name: atual.titular, content: atual.texto, pdfs: atual.pdfs,
      })
    } catch (err) {
      // A mensagem já saiu pelo WhatsApp; falhar o histórico não pode travar a fila.
      toast.error('Enviado, mas não consegui registrar no histórico: ' + (err.message || ''))
    } finally {
      setRegistrando(false)
    }
    onMarcado(atual.id, 'enviado')
    avancar()
  }

  function pular() {
    onMarcado(atual.id, 'pulado')
    avancar()
  }

  const podeCompartilhar = celular && typeof navigator.canShare === 'function' &&
    arquivosDoAtual.length > 0 && navigator.canShare({ files: arquivosDoAtual })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl w-full max-w-lg shadow-xl max-h-[92vh] flex flex-col">

        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
          <div>
            <h3 className="font-display font-semibold text-navy-500">Enviar pelo meu WhatsApp</h3>
            <p className="text-xs text-gray-400">{enviados} de {itens.length} enviada(s)</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>

        <div className="h-1 bg-gray-100">
          <div className="h-1 bg-emerald-500 transition-all"
            style={{ width: `${(resolvidos / itens.length) * 100}%` }} />
        </div>

        <div className="p-5 overflow-auto space-y-4">
          {!celular && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-gray-400">Abrir no:</span>
              {[['web', 'WhatsApp Web'], ['app', 'App do computador']].map(([m, rotulo]) => (
                <button key={m} onClick={() => trocarModo(m)}
                  className={`px-2.5 py-1 rounded-lg border ${modo === m
                    ? 'border-navy-500 bg-navy-50 text-navy-500' : 'border-gray-200 text-gray-500'}`}>
                  {rotulo}
                </button>
              ))}
            </div>
          )}

          {acabou ? (
            <div className="text-center py-8">
              <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-3">
                <Check size={24} />
              </div>
              <p className="font-medium text-navy-500">Pronto!</p>
              <p className="text-sm text-gray-500 mt-1">
                {enviados} mensagem(ns) enviada(s)
                {resolvidos > enviados && ` · ${resolvidos - enviados} pulada(s)`}
              </p>
              <button onClick={onClose} className="btn-primary mt-5">Fechar</button>
            </div>
          ) : (
            <>
              <div>
                <p className="text-xs text-gray-400">Cliente {indice + 1} de {itens.length}</p>
                <h4 className="font-display font-semibold text-navy-500 text-lg">{atual.nome}</h4>
                <p className="text-sm text-gray-600">
                  <span className="font-mono">{formatarTelefone(atual.telefone)}</span>
                  {atual.titular && atual.titular !== atual.nome &&
                    <span className="text-gray-400"> · {atual.titular}</span>}
                </p>
              </div>

              <div className="bg-[#DCF8C6] rounded-lg p-3 max-h-48 overflow-auto">
                <p className="text-sm whitespace-pre-wrap text-gray-800">{atual.texto}</p>
              </div>

              {atual.pdfs.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {atual.pdfs.map(p => (
                    <span key={p.id}
                      className="flex items-center gap-1 text-xs bg-gray-50 border border-gray-200 text-gray-600 px-2 py-1 rounded">
                      <FileText size={11} className={arquivos[p.id] ? 'text-emerald-600' : 'text-gray-300'} />
                      {p.name}
                    </span>
                  ))}
                </div>
              )}

              <div className="space-y-2">
                <button onClick={abrirConversa} disabled={!celular && !pdfsProntos}
                  className="btn-primary w-full justify-center gap-2">
                  <MessageCircle size={16} />
                  {!celular && !pdfsProntos ? 'Preparando PDF...'
                    : celular ? '1 · Abrir conversa com o texto'
                    : atual.pdfs.length > 0 ? 'Abrir conversa e baixar PDF' : 'Abrir conversa'}
                </button>

                {celular && atual.pdfs.length > 0 && (
                  <button onClick={compartilharPdf} disabled={!podeCompartilhar}
                    className="btn-secondary w-full justify-center gap-2">
                    <Share2 size={16} />
                    {!pdfsProntos ? 'Preparando PDF...' : '2 · Enviar PDF (escolha o contato)'}
                  </button>
                )}

                {!celular && atual.pdfs.length > 0 && (
                  <p className="text-xs text-gray-500 flex items-start gap-1.5">
                    <Download size={13} className="shrink-0 mt-0.5" />
                    O PDF é baixado junto. Arraste o arquivo da barra de downloads para a
                    conversa e confira se o texto e o anexo foram enviados.
                  </p>
                )}
                {celular && atual.pdfs.length > 0 && !podeCompartilhar && pdfsProntos && (
                  <p className="text-xs text-amber-600">
                    Este navegador não compartilha arquivos. Use o Chrome (Android) ou o Safari (iPhone).
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between gap-2 pt-2 border-t border-gray-100">
                <button onClick={copiarTexto} className="text-xs text-accent-600 hover:underline flex items-center gap-1">
                  <Copy size={13} /> Copiar texto
                </button>
                <div className="flex gap-2">
                  <button onClick={pular} className="btn-secondary gap-1.5 text-xs">
                    <SkipForward size={14} /> Pular
                  </button>
                  <button onClick={marcarEnviado} disabled={registrando}
                    className="btn-primary gap-1.5 text-xs">
                    <Send size={14} /> {registrando ? 'Registrando...' : 'Enviei · próximo'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
