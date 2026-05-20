import React from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useUser } from '../state/UserContext.jsx'

// Route guard. Redirects to /login (or /admin for admin routes) preserving
// the originally-requested path in `?next=` so the user lands back where
// they were after a successful sign-in.
//
// Render order:
//   loading  → skeleton (avoids a flash of redirect during the initial /me)
//   no user  → redirect to /login?next=...
//   not admin (when adminOnly) → redirect to / (silently — typical client gate)
//   ok       → children

export default function Protected({ children, adminOnly = false }) {
  const { me, loading } = useUser()
  const { pathname, search } = useLocation()

  if (loading) {
    return (
      <div className="space-y-4 animate-fade-in">
        <div className="skeleton h-8 w-48 rounded" />
        <div className="skeleton h-40 rounded-2xl" />
        <div className="skeleton h-64 rounded-2xl" />
      </div>
    )
  }
  if (!me) {
    const next = encodeURIComponent(pathname + (search ?? ''))
    return <Navigate to={`/login?next=${next}`} replace />
  }
  if (adminOnly && me.role !== 'ADMIN') {
    return <Navigate to="/" replace />
  }
  return children
}
