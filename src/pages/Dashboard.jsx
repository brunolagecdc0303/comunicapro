import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'
import { getDashboardStats } from '../lib/api'
import { Users, Send, MessageSquare, TrendingUp } from 'lucide-react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'

const statusColors = {
  draft: 'bg-gray-100 text-gray-700',
  scheduled: 'bg-blue-100 text-blue-700',
  running: 'bg-amber-100 text-amber-700',
  completed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  paused: 'bg-gray-100 text-gray-600',
}

const statusLabels = {
  draft: 'Rascunho',
  scheduled: 'Agendada',
  running: 'Enviando',
  completed: 'Concluída',
  failed: 'Falhou',
  paused: 'Pausada',
}

export default function Dashboard() {
  const { team } = useAuth()
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (team?.id) {
      getDashboardStats(team.id)
        .then(setStats)
        .finally(() => setLoading(false))
    }
  }, [team])

  if (loading) return <Loading />

  const cards = [
    { label: 'Contatos', value: stats?.totalContacts || 0, icon: Users, color: 'bg-blue-500' },
    { label: 'Mensagens Enviadas', value: stats?.totalMessages || 0, icon: MessageSquare, color: 'bg-green-500' },
    { label: 'Campanhas', value: stats?.recentCampaigns?.length || 0, icon: Send, color: 'bg-accent-500' },
  ]

  return (
    <div>
      <h2 className="text-2xl font-display font-bold text-navy-500 mb-6">Dashboard</h2>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {cards.map(c => (
          <div key={c.label} className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm">
            <div className="flex items-center gap-3 mb-3">
              <div className={`${c.color} w-10 h-10 rounded-lg flex items-center justify-center`}>
                <c.icon className="text-white" size={20} />
              </div>
              <span className="text-sm text-gray-500 font-medium">{c.label}</span>
            </div>
            <p className="text-3xl font-display font-bold text-navy-500">{c.value.toLocaleString('pt-BR')}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="font-display font-semibold text-navy-500">Campanhas Recentes</h3>
        </div>
        {stats?.recentCampaigns?.length > 0 ? (
          <div className="divide-y divide-gray-50">
            {stats.recentCampaigns.map(c => (
              <div key={c.id} className="px-5 py-3.5 flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm text-gray-900">{c.name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {format(new Date(c.created_at), "dd MMM yyyy, HH:mm", { locale: ptBR })}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-500">
                    {c.sent_count}/{c.total_recipients}
                  </span>
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${statusColors[c.status]}`}>
                    {statusLabels[c.status]}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-8 text-center text-gray-400 text-sm">
            Nenhuma campanha ainda. Crie sua primeira!
          </div>
        )}
      </div>
    </div>
  )
}

function Loading() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="animate-spin w-8 h-8 border-2 border-navy-500 border-t-transparent rounded-full" />
    </div>
  )
}
