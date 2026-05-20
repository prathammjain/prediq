import React from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Compass } from 'lucide-react'

// Real 404 page — preserves the URL the user tried to visit so they can see
// what went wrong, instead of silently redirecting to /.
export default function NotFound() {
  const { pathname } = useLocation()
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center animate-fade-in">
      <Compass size={56} strokeWidth={1.25} className="mb-5 text-muted" aria-hidden="true" />
      <h1 className="text-2xl font-bold mb-2">Page not found</h1>
      <p className="text-sm text-muted max-w-sm mb-1">
        We couldn&rsquo;t find anything at <code className="text-text bg-surface px-1.5 py-0.5 rounded text-[12px]">{pathname}</code>.
      </p>
      <p className="text-xs text-muted max-w-sm mb-6">
        The market may have been removed or the link mistyped.
      </p>
      <div className="flex gap-2">
        <Link
          to="/"
          className="px-4 py-2 rounded-lg bg-gradient-to-br from-accent to-indigo-500 text-white text-sm font-semibold shadow-glow hover:-translate-y-px transition"
        >
          Browse markets
        </Link>
        <Link
          to="/leaderboard"
          className="px-4 py-2 rounded-lg bg-surface border border-border text-sm font-semibold text-text hover:border-accent/40 transition"
        >
          See the leaderboard
        </Link>
      </div>
    </div>
  )
}
