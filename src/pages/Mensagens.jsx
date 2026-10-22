import { useSearchParams } from 'react-router-dom'
import { MessageSquare, Send, CalendarClock, FileText } from 'lucide-react'
import NovaMensagem from './NovaMensagem'
import Campanhas from './Campanhas'
import EnviosProgramados from './EnviosProgramados'
import Templates from './Templates'

/**
 * Tudo que é mensagem num lugar só. Cada aba é a tela que já existia;
 * a aba fica na URL (?aba=...) para o link continuar funcionando.
 */
const ABAS = [
  { key: 'nova', label: 'Nova mensagem', icon: MessageSquare, Tela: NovaMensagem },
  { key: 'campanhas', label: 'Campanhas', icon: Send, Tela: Campanhas },
  { key: 'programados', label: 'Envios programados', icon: CalendarClock, Tela: EnviosProgramados },
  { key: 'templates', label: 'Templates', icon: FileText, Tela: Templates },
]

export default function Mensagens() {
  const [params, setParams] = useSearchParams()
  const atual = ABAS.find(a => a.key === params.get('aba')) || ABAS[0]
  const Tela = atual.Tela

  return (
    <div>
      <div className="flex gap-1 border-b border-gray-200 mb-6 overflow-x-auto">
        {ABAS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setParams(key === 'nova' ? {} : { aba: key })}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
              atual.key === key
                ? 'border-accent-500 text-navy-500'
                : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>
      <Tela key={atual.key} />
    </div>
  )
}
