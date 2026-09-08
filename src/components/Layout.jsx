import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import {
  LayoutDashboard, Users, MessageSquare, Send,
  FileText, Settings, LogOut, Menu, X, CalendarClock, Table2
} from 'lucide-react'
import { useState } from 'react'

const nav = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/contatos', icon: Users, label: 'Contatos' },
  { to: '/acompanhamento', icon: Table2, label: 'Acompanhamento' },
  { to: '/templates', icon: FileText, label: 'Templates' },
  { to: '/campanhas', icon: Send, label: 'Campanhas' },
  { to: '/envios-programados', icon: CalendarClock, label: 'Envios Programados' },
  { to: '/mensagens', icon: MessageSquare, label: 'Nova Mensagem' },
  { to: '/config', icon: Settings, label: 'Configurações' },
]

export default function Layout() {
  const { user, team, signOut } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-40 w-64 bg-navy-500 text-white
        transform transition-transform duration-200 ease-in-out
        lg:translate-x-0 lg:static lg:flex lg:flex-col
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="p-5 border-b border-navy-400">
          <h1 className="font-display text-xl font-bold tracking-tight">
            Comunica<span className="text-accent-400">Pro</span>
          </h1>
          {team && (
            <p className="text-navy-200 text-xs mt-1 truncate">{team.name}</p>
          )}
        </div>

        <nav className="flex-1 py-4 space-y-0.5 px-3">
          {nav.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) => `
                flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium
                transition-colors duration-150
                ${isActive
                  ? 'bg-navy-400 text-white'
                  : 'text-navy-200 hover:bg-navy-400/50 hover:text-white'}
              `}
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="p-4 border-t border-navy-400">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-full bg-accent-500 flex items-center justify-center text-sm font-bold">
              {user?.email?.[0]?.toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user?.email}</p>
              <p className="text-xs text-navy-200 capitalize">{team?.role || 'membro'}</p>
            </div>
          </div>
          <button
            onClick={signOut}
            className="flex items-center gap-2 text-navy-200 hover:text-white text-sm w-full"
          >
            <LogOut size={16} /> Sair
          </button>
        </div>
      </aside>

      {/* Overlay mobile */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main */}
      <main className="flex-1 min-w-0">
        <header className="bg-white border-b px-4 py-3 flex items-center gap-3 lg:hidden">
          <button onClick={() => setSidebarOpen(true)} className="p-1">
            <Menu size={22} />
          </button>
          <h1 className="font-display text-lg font-bold text-navy-500">
            Comunica<span className="text-accent-500">Pro</span>
          </h1>
        </header>
        <div className="p-4 lg:p-8 max-w-6xl">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
