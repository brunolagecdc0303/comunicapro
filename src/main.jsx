import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { AuthProvider, useAuth } from './hooks/useAuth'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Contatos from './pages/Contatos'
import Templates from './pages/Templates'
import Campanhas from './pages/Campanhas'
import EnviosProgramados from './pages/EnviosProgramados'
import NovaMensagem from './pages/NovaMensagem'
import Config from './pages/Config'
import './styles/index.css'

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin w-8 h-8 border-2 border-navy-500 border-t-transparent rounded-full" />
    </div>
  )
  return user ? children : <Navigate to="/login" />
}

function AppRoutes() {
  const { user, loading } = useAuth()
  if (loading) return null

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" /> : <Login />} />
      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<Dashboard />} />
        <Route path="contatos" element={<Contatos />} />
        <Route path="templates" element={<Templates />} />
        <Route path="campanhas" element={<Campanhas />} />
        <Route path="envios-programados" element={<EnviosProgramados />} />
        <Route path="mensagens" element={<NovaMensagem />} />
        <Route path="config" element={<Config />} />
      </Route>
    </Routes>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
        <Toaster
          position="top-right"
          toastOptions={{
            style: { fontFamily: 'Inter, sans-serif', fontSize: '14px' },
          }}
        />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
)
