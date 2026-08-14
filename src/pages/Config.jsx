import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { Save, Eye, EyeOff, Users, Key } from 'lucide-react'
import toast from 'react-hot-toast'

export default function Config() {
  const { team } = useAuth()
  const [wasenderKey, setWasenderKey] = useState('')
  const [geminiKey, setGeminiKey] = useState('')
  const [showWasender, setShowWasender] = useState(false)
  const [showGemini, setShowGemini] = useState(false)
  const [delay, setDelay] = useState(5)
  const [dailyLimit, setDailyLimit] = useState(500)
  const [saving, setSaving] = useState(false)
  const [members, setMembers] = useState([])

  useEffect(() => {
    if (team) {
      setWasenderKey(team.wasender_api_key || '')
      setGeminiKey(team.gemini_api_key || '')
      setDelay(team.settings?.delay_between_messages || 5)
      setDailyLimit(team.settings?.daily_limit || 500)
      loadMembers()
    }
  }, [team])

  async function loadMembers() {
    const { data } = await supabase
      .from('team_members')
      .select('role, user_id')
      .eq('team_id', team.id)
    setMembers(data || [])
  }

  async function handleSave() {
    setSaving(true)
    try {
      const { error } = await supabase
        .from('teams')
        .update({
          wasender_api_key: wasenderKey,
          gemini_api_key: geminiKey,
          settings: { delay_between_messages: delay, daily_limit: dailyLimit },
        })
        .eq('id', team.id)
      if (error) throw error
      toast.success('Configurações salvas')
    } catch {
      toast.error('Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <h2 className="text-2xl font-display font-bold text-navy-500 mb-6">Configurações</h2>

      <div className="space-y-6 max-w-xl">
        {/* API Keys */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Key size={18} className="text-navy-500" />
            <h3 className="font-display font-semibold text-navy-500">Chaves de API</h3>
          </div>

          <div>
            <label className="label">Wasender API Key</label>
            <div className="relative">
              <input
                type={showWasender ? 'text' : 'password'}
                value={wasenderKey}
                onChange={e => setWasenderKey(e.target.value)}
                placeholder="Sua chave da Wasender..."
                className="input pr-10"
              />
              <button
                onClick={() => setShowWasender(!showWasender)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showWasender ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div>
            <label className="label">Gemini API Key</label>
            <div className="relative">
              <input
                type={showGemini ? 'text' : 'password'}
                value={geminiKey}
                onChange={e => setGeminiKey(e.target.value)}
                placeholder="Sua chave do Gemini..."
                className="input pr-10"
              />
              <button
                onClick={() => setShowGemini(!showGemini)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showGemini ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
        </div>

        {/* Envio */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-4">
          <h3 className="font-display font-semibold text-navy-500">Configurações de Envio</h3>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Delay entre mensagens (seg)</label>
              <input
                type="number"
                value={delay}
                onChange={e => setDelay(Number(e.target.value))}
                min={2}
                max={30}
                className="input"
              />
              <p className="text-xs text-gray-400 mt-1">Mínimo 2s para evitar bloqueio</p>
            </div>
            <div>
              <label className="label">Limite diário</label>
              <input
                type="number"
                value={dailyLimit}
                onChange={e => setDailyLimit(Number(e.target.value))}
                min={10}
                max={5000}
                className="input"
              />
              <p className="text-xs text-gray-400 mt-1">Mensagens por dia</p>
            </div>
          </div>
        </div>

        {/* Time */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Users size={18} className="text-navy-500" />
            <h3 className="font-display font-semibold text-navy-500">Time ({members.length}/5)</h3>
          </div>
          <p className="text-xs text-gray-400">
            Gerencie membros no painel do Supabase (Authentication → Users).
            Cada membro precisa ser convidado e vinculado ao time.
          </p>
          <div className="space-y-2">
            {members.map(m => (
              <div key={m.user_id} className="flex items-center justify-between py-2 px-3 bg-gray-50 rounded-lg text-sm">
                <span className="font-mono text-xs text-gray-600">{m.user_id.slice(0, 8)}...</span>
                <span className="text-xs bg-navy-50 text-navy-500 px-2 py-0.5 rounded capitalize">{m.role}</span>
              </div>
            ))}
          </div>
        </div>

        <button onClick={handleSave} disabled={saving} className="btn-primary w-full gap-1.5">
          {saving ? (
            <><div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" /> Salvando...</>
          ) : (
            <><Save size={16} /> Salvar Configurações</>
          )}
        </button>
      </div>
    </div>
  )
}
