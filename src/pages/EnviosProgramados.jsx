import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'
import { getCampaigns, cancelCampaign } from '../lib/api'
import CampaignModal from '../components/CampaignModal'
import { CalendarClock, Plus, Clock, Users, Send, XCircle, Ban } from 'lucide-react'
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
  draft: 'Rascunho', scheduled: 'Programado', running: 'Processando',
  completed: 'Concluído', failed: 'Erro', paused: 'Pausada', cancelled: 'Cancelado',
}

// Envios que ainda vão acontecer (ou estão acontecendo agora)
const UPCOMING_STATUSES = ['draft', 'scheduled', 'running']

export default function EnviosProgramados() {
  const { user, team } = useAuth()
  const [campaigns, setCampaigns] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [cancellingId, setCancellingId] = useState(null)

  useEffect(() => {
    if (team?.id) load()
  }, [team])

  async function load() {
    setLoading(true)
    try { setCampaigns(await getCampaigns(team.id)) }
    catch { toast.error('Erro ao carregar envios') }
    finally { setLoading(false) }
  }

  async function handleCancel(id) {
    if (!confirm('Cancelar este envio? As mensagens ainda não enviadas não serão disparadas.')) return
    setCancellingId(id)
    try {
      await cancelCampaign(id)
      toast.success('Envio cancelado')
      load()
    } catch (err) {
      toast.error('Erro ao cancelar: ' + (err.message || ''))
    } finally {
      setCancellingId(null)
    }
  }

  const upcoming = campaigns
    .filter(c => UPCOMING_STATUSES.includes(c.status))
    .sort((a, b) => new Date(a.scheduled_at || a.created_at) - new Date(b.scheduled_at || b.created_at))
  const history = campaigns
    .filter(c => !UPCOMING_STATUSES.includes(c.status))

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-display font-bold text-navy-500">Envios Programados</h2>
          <p className="text-sm text-gray-400 mt-0.5">Agende campanhas e acompanhe o que está por vir.</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary gap-1.5">
          <Plus size={16} /> Novo Envio
        </button>
      </div>

      {loading ? (
        <div className="p-12 text-center">
          <div className="animate-spin w-6 h-6 border-2 border-navy-500 border-t-transparent rounded-full mx-auto" />
        </div>
      ) : (
        <div className="space-y-8">
          <section>
            <h3 className="text-sm font-display font-semibold text-navy-500 mb-3">Próximos envios</h3>
            {upcoming.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-100 p-10 text-center">
                <CalendarClock className="mx-auto text-gray-300 mb-3" size={36} />
                <p className="text-gray-500 text-sm mb-4">Nenhum envio programado no momento.</p>
                <button onClick={() => setShowCreate(true)} className="btn-primary gap-1.5">
                  <Plus size={16} /> Programar envio
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {upcoming.map(c => (
                  <CampaignCard
                    key={c.id}
                    campaign={c}
                    onCancel={() => handleCancel(c.id)}
                    cancelling={cancellingId === c.id}
                  />
                ))}
              </div>
            )}
          </section>

          <section>
            <h3 className="text-sm font-display font-semibold text-navy-500 mb-3">Histórico</h3>
            {history.length === 0 ? (
              <p className="text-sm text-gray-400">Ainda não há envios concluídos, cancelados ou com erro.</p>
            ) : (
              <div className="space-y-3">
                {history.map(c => <CampaignCard key={c.id} campaign={c} />)}
              </div>
            )}
          </section>
        </div>
      )}

      {showCreate && (
        <CampaignModal
          teamId={team.id}
          userId={user.id}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); load() }}
        />
      )}
    </div>
  )
}

function CampaignCard({ campaign: c, onCancel, cancelling }) {
  const canCancel = !!onCancel && ['scheduled', 'running', 'draft'].includes(c.status)
  const pending = Math.max(c.total_recipients - c.sent_count - c.failed_count, 0)

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display font-semibold text-navy-500 truncate">{c.name}</h3>
          <p className="text-xs text-gray-400 mt-1">
            Criado em {format(new Date(c.created_at), "dd MMM yyyy, HH:mm", { locale: ptBR })}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${statusColors[c.status]}`}>
            {statusLabels[c.status]}
          </span>
          {canCancel && (
            <button
              onClick={onCancel}
              disabled={cancelling}
              title="Cancelar envio"
              className="text-gray-400 hover:text-red-500 disabled:opacity-50"
            >
              {cancelling ? <div className="animate-spin w-4 h-4 border-2 border-gray-300 border-t-transparent rounded-full" /> : <Ban size={16} />}
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-1 mt-4 text-sm text-gray-500">
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
            <XCircle size={14} />
            <span>{c.failed_count} falhas</span>
          </div>
        )}
        {pending > 0 && UPCOMING_STATUSES.includes(c.status) && (
          <div className="flex items-center gap-1.5">
            <span>{pending} na fila</span>
          </div>
        )}
        {c.scheduled_at && (
          <div className="flex items-center gap-1.5">
            <Clock size={14} />
            <span>{format(new Date(c.scheduled_at), "dd/MM HH:mm")}</span>
          </div>
        )}
      </div>

      {c.total_recipients > 0 && (
        <div className="mt-3">
          <div className="w-full bg-gray-100 rounded-full h-1.5 flex overflow-hidden">
            <div className="bg-green-500 h-1.5" style={{ width: `${(c.sent_count / c.total_recipients) * 100}%` }} />
            <div className="bg-red-400 h-1.5" style={{ width: `${(c.failed_count / c.total_recipients) * 100}%` }} />
          </div>
        </div>
      )}
    </div>
  )
}
