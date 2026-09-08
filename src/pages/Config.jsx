import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { Save, Eye, EyeOff, Users, Key, BellRing, Send } from 'lucide-react'
import toast from 'react-hot-toast'
import { previewFPReminders, saveTeamSettings } from '../lib/api'

const DEFAULT_FP_TEMPLATE =
  'Oi {{nome}}! Passando para lembrar que seu Financial Planning está previsto para {{data}}. Podemos agendar nossa conversa?'

export default function Config() {
  const { team } = useAuth()
  const [wasenderKey, setWasenderKey] = useState('')
  const [claudeKey, setClaudeKey] = useState('')
  const [showWasender, setShowWasender] = useState(false)
  const [showClaude, setShowClaude] = useState(false)
  const [delay, setDelay] = useState(5)
  const [dailyLimit, setDailyLimit] = useState(500)
  const [saving, setSaving] = useState(false)
  const [members, setMembers] = useState([])

  // Lembretes de FP
  const [fpEnabled, setFpEnabled] = useState(false)
  const [fpDays, setFpDays] = useState(7)
  const [fpAdvisorPhone, setFpAdvisorPhone] = useState('')
  const [fpTemplate, setFpTemplate] = useState(DEFAULT_FP_TEMPLATE)
  const [preview, setPreview] = useState(null)
  const [loadingPreview, setLoadingPreview] = useState(false)

  useEffect(() => {
    if (team) {
      setDelay(team.settings?.delay_between_messages || 5)
      setDailyLimit(team.settings?.daily_limit || 500)
      setFpEnabled(!!team.settings?.fp_reminder_enabled)
      setFpDays(team.settings?.fp_reminder_days_before ?? 7)
      setFpAdvisorPhone(team.settings?.fp_reminder_advisor_phone || '')
      setFpTemplate(team.settings?.fp_reminder_template || DEFAULT_FP_TEMPLATE)
      loadKeys()
      loadMembers()
    }
  }, [team])

  // Chaves de API não ficam no estado global do app (useAuth) — só são buscadas
  // aqui, na tela onde de fato são exibidas/editadas.
  async function loadKeys() {
    const { data } = await supabase
      .from('teams')
      .select('wasender_api_key, claude_api_key')
      .eq('id', team.id)
      .single()
    setWasenderKey(data?.wasender_api_key || '')
    setClaudeKey(data?.claude_api_key || '')
  }

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
        .update({ wasender_api_key: wasenderKey, claude_api_key: claudeKey })
        .eq('id', team.id)
      if (error) throw error

      // settings é um jsonb só: salvar via merge, senão uma tela apagaria
      // as configurações da outra.
      await saveTeamSettings(team.id, {
        delay_between_messages: delay,
        daily_limit: dailyLimit,
        fp_reminder_enabled: fpEnabled,
        fp_reminder_days_before: fpDays,
        fp_reminder_advisor_phone: fpAdvisorPhone.replace(/\D/g, ''),
        fp_reminder_template: fpTemplate,
      })
      toast.success('Configurações salvas')
    } catch {
      toast.error('Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  async function handlePreview() {
    setLoadingPreview(true)
    try {
      setPreview(await previewFPReminders(team.id))
    } catch (err) {
      toast.error('Erro ao pré-visualizar: ' + (err.message || ''))
    } finally {
      setLoadingPreview(false)
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
            <label className="label">Claude API Key (Anthropic)</label>
            <div className="relative">
              <input
                type={showClaude ? 'text' : 'password'}
                value={claudeKey}
                onChange={e => setClaudeKey(e.target.value)}
                placeholder="sk-ant-api03-..."
                className="input pr-10"
              />
              <button
                onClick={() => setShowClaude(!showClaude)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showClaude ? <EyeOff size={16} /> : <Eye size={16} />}
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

        {/* Lembretes de FP */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-4">
          <div className="flex items-center gap-2">
            <BellRing size={18} className="text-navy-500" />
            <h3 className="font-display font-semibold text-navy-500">Lembretes de FP</h3>
          </div>
          <p className="text-xs text-gray-400">
            Quando a data do próximo FP se aproxima, o cliente recebe um lembrete no WhatsApp
            e você recebe um resumo do que saiu. Roda uma vez por dia, às 9h.
          </p>

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={fpEnabled}
              onChange={e => setFpEnabled(e.target.checked)} className="rounded" />
            Ativar lembretes automáticos
          </label>

          {fpEnabled && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Avisar com quantos dias</label>
                  <input type="number" value={fpDays} min={1} max={90}
                    onChange={e => setFpDays(Number(e.target.value))} className="input" />
                </div>
                <div>
                  <label className="label">Seu WhatsApp (cópia)</label>
                  <input type="text" value={fpAdvisorPhone}
                    onChange={e => setFpAdvisorPhone(e.target.value)}
                    placeholder="5531988887777" className="input" />
                </div>
              </div>

              <div>
                <label className="label">Mensagem para o cliente</label>
                <textarea rows={3} value={fpTemplate}
                  onChange={e => setFpTemplate(e.target.value)} className="input" />
                <p className="text-xs text-gray-400 mt-1">
                  <code>{'{{nome}}'}</code> vira o nome do cliente e <code>{'{{data}}'}</code> a data do FP.
                </p>
              </div>

              <div className="border-t border-gray-100 pt-4">
                <button onClick={handlePreview} disabled={loadingPreview}
                  className="btn-secondary text-xs gap-1.5">
                  <Send size={14} /> {loadingPreview ? 'Verificando...' : 'Ver o que sairia hoje'}
                </button>

                {preview && (
                  <div className="mt-3">
                    {preview.length === 0 ? (
                      <p className="text-xs text-gray-400">
                        Nenhum FP vence nos próximos {fpDays} dias — nada seria enviado hoje.
                      </p>
                    ) : (
                      <ul className="space-y-2">
                        {preview.map((m, i) => (
                          <li key={i} className="text-xs bg-gray-50 rounded-lg p-3">
                            <div className="flex items-center gap-2 mb-1">
                              <span className={`px-1.5 py-0.5 rounded ${
                                m.recipient === 'assessor'
                                  ? 'bg-accent-100 text-accent-600'
                                  : 'bg-navy-50 text-navy-500'}`}>
                                {m.recipient === 'assessor' ? 'para você' : m.contact_name}
                              </span>
                              <span className="text-gray-400 font-mono">{m.phone}</span>
                            </div>
                            <p className="text-gray-600 whitespace-pre-line">{m.content}</p>
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="text-xs text-gray-400 mt-2">
                      Pré-visualização — nada foi enviado nem marcado como enviado.
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
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
