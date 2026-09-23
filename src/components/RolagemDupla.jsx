import { useRef, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

/**
 * Tabela larga com barra de rolagem TAMBÉM em cima.
 *
 * Com 17 colunas de produto, a barra só no rodapé obriga a descer até o fim da
 * lista para deslocar a tabela e subir de novo para ler o cabeçalho. A barra de
 * cima é um div vazio com a mesma largura do conteúdo, sincronizado nos dois
 * sentidos, mais setas para quem prefere clicar.
 */
export default function RolagemDupla({ children }) {
  const superior = useRef(null)
  const conteudo = useRef(null)
  const [largura, setLargura] = useState(0)
  // temRolagem precisa ser ESTADO, não algo calculado no render a partir da
  // ref: o React não re-renderiza quando clientWidth muda, então a barra de
  // cima simplesmente nunca aparecia.
  const [temRolagem, setTemRolagem] = useState(false)
  const [pode, setPode] = useState({ esquerda: false, direita: false })

  useEffect(() => {
    const el = conteudo.current
    if (!el) return

    const medir = () => {
      setLargura(el.scrollWidth)
      setTemRolagem(el.scrollWidth > el.clientWidth + 4)
      atualizarSetas()
    }
    const atualizarSetas = () => {
      setPode({
        esquerda: el.scrollLeft > 4,
        direita: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
      })
    }

    medir()
    // A largura muda quando a aba troca (nº de colunas diferente) e quando a
    // janela é redimensionada.
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    el.addEventListener('scroll', atualizarSetas)
    return () => { ro.disconnect(); el.removeEventListener('scroll', atualizarSetas) }
  }, [children])

  // Sincronia: quem move um move o outro, com trava para não ecoar.
  const travado = useRef(false)
  const espelhar = (origem, destino) => () => {
    if (travado.current) return
    travado.current = true
    destino.current.scrollLeft = origem.current.scrollLeft
    requestAnimationFrame(() => { travado.current = false })
  }

  const deslizar = (direcao) => {
    const el = conteudo.current
    if (!el) return
    el.scrollBy({ left: direcao * Math.max(240, el.clientWidth * 0.7), behavior: 'smooth' })
  }

  return (
    <div className="relative">
      {temRolagem && (
        <div className="flex items-center gap-2 px-3 pt-2">
          <button onClick={() => deslizar(-1)} disabled={!pode.esquerda}
            aria-label="Rolar para a esquerda"
            className="p-1 rounded border border-gray-200 text-gray-500 hover:bg-gray-50
                       disabled:opacity-30 disabled:cursor-default shrink-0">
            <ChevronLeft size={14} />
          </button>

          <div ref={superior} onScroll={espelhar(superior, conteudo)}
            className="overflow-x-auto flex-1" style={{ scrollbarWidth: 'thin' }}>
            <div style={{ width: largura, height: 1 }} />
          </div>

          <button onClick={() => deslizar(1)} disabled={!pode.direita}
            aria-label="Rolar para a direita"
            className="p-1 rounded border border-gray-200 text-gray-500 hover:bg-gray-50
                       disabled:opacity-30 disabled:cursor-default shrink-0">
            <ChevronRight size={14} />
          </button>
        </div>
      )}

      <div ref={conteudo} onScroll={espelhar(conteudo, superior)} className="overflow-x-auto">
        {children}
      </div>
    </div>
  )
}
