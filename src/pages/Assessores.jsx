import { useState, useEffect } from 'react'
import { ShieldCheck, UserPlus, Users, Copy, AlertTriangle, Check } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '../hooks/useAuth'
import { listarTimes, criarAssessor } from '../lib/api'

function senhaForte() {
  // Sem caracteres ambíguos (O/0, l/1): a senha vai ser passada por WhatsApp
  // e digitada à mão.
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  return Array.from(crypto.getRandomValues(new Uint32Array(14)))
    .map(n => abc[n % abc.length]).join('')
}

export default function Assessores() {
  const { ehAdmin } = useAuth()
  const [times, setTimes] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [form, setForm] = useState({ email: '', nomeDoTime: '', senha: senhaForte() })
  const [criando, setCriando] = useState(false)
  const [criado, setCriado] = useState(null)

  useEffect(() => { if (ehAdmin) carregar() }, [ehAdmin])

  async function carregar() {
    setCarregando(true)
    try {
      setTimes(await listarTimes())
    } catch (err) {
      toast.error('Erro ao listar times: ' + (err.message || ''))
    } finally {
      setCarregando(false)
    }
  }

  async function criar() {
    if (!form.email.trim() || !form.nomeDoTime.trim()) {
      return toast.error('Informe o email e o nome da carteira')
    }
    setCriando(true)
    try {
      await criarAssessor(form.email.trim(), form.senha, form.nomeDoTime.trim())
      setCriado({ email: form.email.trim(), senha: form.senha })
      setForm({ email: '', nomeDoTime: '', senha: senhaForte() })
      await carregar()
      toast.success('Assessor criado')
    } catch (err) {
      toast.error(err.message || 'Erro ao criar assessor')
    } finally {
      setCriando(false)
    }
  }

  function copiar(texto) {
    navigator.clipboard.writeText(texto)
    toast.success('Copiado')
  }

  if (!ehAdmin) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 max-w-lg">
        <p className="text-sm text-gray-600">Esta área é restrita a administradores.</p>
      </div>
    )
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h2 className="text-2xl font-display font-bold text-navy-500 flex items-center gap-2">
          <ShieldCheck size={22} /> Assessores
        </h2>
        <p className="text-sm text-gray-400 mt-0.5">
          Cada assessor tem a própria carteira. Contatos, PDFs, mensagens e acompanhamento
          de um não aparecem para o outro.
        </p>
      </div>

      {criado && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5 mb-6">
          <div className="flex items-start gap-2">
            <Check size={18} className="text-emerald-600 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-emerald-900">
                Acesso criado. Entregue estes dados ao assessor:
              </p>
              <div className="mt-3 space-y-2">
                {[['Email', criado.email], ['Senha', criado.senha]].map(([rotulo, valor]) => (
                  <div key={rotulo} className="flex items-center gap-2">
                    <span className="text-xs text-emerald-800 w-12">{rotulo}</span>
                    <code className="flex-1 bg-white border border-emerald-200 rounded px-2 py-1
                                     text-sm font-mono truncate">{valor}</code>
                    <button onClick={() => copiar(valor)}
                      className="text-emerald-700 hover:text-emerald-900 p-1" title="Copiar">
                      <Copy size={14} />
                    </button>
                  </div>
                ))}
              </div>
              <p className="text-xs text-emerald-800 mt-3 flex items-start gap-1">
                <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                A senha aparece só desta vez — ela não fica guardada em lugar nenhum.
                Copie agora e peça para o assessor trocá-la depois.
              </p>
              <button onClick={() => setCriado(null)}
                className="text-xs text-emerald-700 hover:underline mt-2">Entendi, esconder</button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 mb-6 space-y-4">
        <h3 className="font-display font-semibold text-navy-500 flex items-center gap-2">
          <UserPlus size={18} /> Novo assessor
        </h3>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Email do assessor</label>
            <input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
              placeholder="assessor@exemplo.com" className="input" />
          </div>
          <div>
            <label className="label">Nome da carteira</label>
            <input value={form.nomeDoTime} onChange={e => setForm({ ...form, nomeDoTime: e.target.value })}
              placeholder="Ex.: Carteira Gustavo" className="input" />
          </div>
        </div>

        <div>
          <label className="label">Senha inicial</label>
          <div className="flex gap-2">
            <input value={form.senha} onChange={e => setForm({ ...form, senha: e.target.value })}
              className="input font-mono" />
            <button onClick={() => setForm({ ...form, senha: senhaForte() })}
              className="btn-secondary text-xs shrink-0">Gerar outra</button>
          </div>
          <p className="text-xs text-gray-400 mt-1">Mínimo 8 caracteres.</p>
        </div>

        <button onClick={criar} disabled={criando} className="btn-primary gap-1.5">
          <UserPlus size={16} /> {criando ? 'Criando...' : 'Criar acesso'}
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100">
          <h3 className="font-display font-semibold text-navy-500 flex items-center gap-2">
            <Users size={18} /> Carteiras ({times.length})
          </h3>
        </div>
        {carregando ? (
          <div className="p-8 text-center">
            <div className="animate-spin w-6 h-6 border-2 border-navy-500 border-t-transparent rounded-full mx-auto" />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-5 py-2.5 text-left font-medium text-gray-500">Carteira</th>
                <th className="px-5 py-2.5 text-center font-medium text-gray-500">Pessoas</th>
                <th className="px-5 py-2.5 text-center font-medium text-gray-500">Clientes</th>
                <th className="px-5 py-2.5 text-left font-medium text-gray-500">Criada em</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {times.map(t => (
                <tr key={t.team_id}>
                  <td className="px-5 py-3 font-medium text-gray-900">{t.nome}</td>
                  <td className="px-5 py-3 text-center text-gray-600">{t.membros}</td>
                  <td className="px-5 py-3 text-center text-gray-600">{t.contatos}</td>
                  <td className="px-5 py-3 text-gray-500 text-xs">
                    {new Date(t.criado_em).toLocaleDateString('pt-BR')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="px-5 py-3 text-xs text-gray-400 border-t border-gray-100">
          Cada carteira precisa da própria chave da Wasender e da Claude, em Configurações —
          as chaves não são compartilhadas entre assessores.
        </p>
      </div>
    </div>
  )
}
