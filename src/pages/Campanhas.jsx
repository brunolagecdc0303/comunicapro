import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'
import { getCampaigns } from '../lib/api'
import CampaignModal from '../components/CampaignModal'
import { Send, Plus, Clock, Users } from 'lucide-react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import toast from 'react-hot-toast'

const statusColors = {
  draft: 'bg-gray-100 text-gray-700',
  scheduled: 'bg-blue-100 text-blue-700',
  running: 'bg-amber-100 text-amber-700',
  completed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  paused: 'bg-gray-100 text-gray-600',
  cancelled: 'bg-gray-100 text-gray-500',
}
const statusLabels = {
  draft: 'Rascunho', scheduled: 'Agendada', running: 'Enviando',
  completed: 'Concluída', failed: 'Falhou', paused: 'Pausada', cancelled: 'Cancelada',
}

export default function Campanhas() {
  const { user, team } = useAuth()
  const [campaigns, setCampaigns] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)

  useEffect(() => {
    if (team?.id) loadCampaigns()
  }, [team])

  async function loadCampaigns() {
    setLoading(true)
    try { setCampaigns(await getCampaigns(team.id)) }
    catch { toast.error('Erro ao carregar campanhas') }
    finally { setLoading(false) }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-display font-bold text-navy-500">Campanhas</h2>
        <button onClick={() => setShowCreate(true)} className="btn-primary gap-1.5">
          <Plus size={16} /> Nova Campanha
        </button>
      </div>

      {loading ? (
        <div className="p-12 text-center">
          <div className="animate-spin w-6 h-6 border-2 border-navy-500 border-t-transparent rounded-full mx-auto" />
        </div>
      ) : campaigns.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
          <Send className="mx-auto text-gray-300 mb-3" size={40} />
          <p className="text-gray-500 text-sm mb-4">Nenhuma campanha. Crie uma para enviar mensagens em massa.</p>
          <button onClick={() => setShowCreate(true)} className="btn-primary gap-1.5">
            <Plus size={16} /> Criar campanha
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {campaigns.map(c => (
            <div key={c.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-display font-semibold text-navy-500">{c.name}</h3>
                  <p className="text-xs text-gray-400 mt-1">
                    {format(new Date(c.created_at), "dd MMM yyyy, HH:mm", { locale: ptBR })}
                  </p>
                </div>
                <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${statusColors[c.status]}`}>
                  {statusLabels[c.status]}
                </span>
              </div>

              <div className="flex gap-6 mt-4 text-sm text-gray-500">
                <div className="flex items-center gap-1.5">
                  <Users size={14} />
                  <span>{c.total_recipients} destinatários</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Send size={14} />
                  <span>{c.sent_count} enviadas</span>
                </div>
                {c.failed_count > 0 && (
                  <div className="text-red-500 flex items-center gap-1.5">
                    <span>{c.failed_count} falhas</span>
                  </div>
                )}
                {c.scheduled_at && (
                  <div className="flex items-center gap-1.5">
                    <Clock size={14} />
                    <span>{format(new Date(c.scheduled_at), "dd/MM HH:mm")}</span>
                  </div>
                )}
              </div>

              {/* Progress bar */}
              {c.total_recipients > 0 && (
                <div className="mt-3">
                  <div className="w-full bg-gray-100 rounded-full h-1.5">
                    <div
                      className="bg-green-500 h-1.5 rounded-full transition-all"
                      style={{ width: `${(c.sent_count / c.total_recipients) * 100}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <CampaignModal
          teamId={team.id}
          userId={user.id}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); loadCampaigns() }}
        />
      )}
    </div>
  )
}
