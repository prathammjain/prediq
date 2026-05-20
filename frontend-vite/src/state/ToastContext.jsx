import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react'

// Toasts replace alert(): non-blocking, premium, auto-dismissing.
//
//   const toast = useToast()
//   toast.success('Claimed 342 chips.')
//   toast.error('Something went wrong.')
//   toast.info('Heads up')
//   toast.show({ kind, title, body, duration })
//
// Top-right stack, max 3 visible, default 4s auto-dismiss. ARIA live region
// so screen readers announce. Each toast renders with a slide-in entrance
// (animate-slide-up) and a manual close affordance.

const ToastContext = createContext(null)

const KIND_META = {
  success: { Icon: CheckCircle2,  border: 'border-yes/40',     accent: 'text-yes',   bg: 'from-yes/15 to-yes/5'   },
  error:   { Icon: AlertTriangle, border: 'border-no/40',      accent: 'text-no',    bg: 'from-no/15 to-no/5'     },
  info:    { Icon: Info,          border: 'border-accent/40',  accent: 'text-accent',bg: 'from-accent/15 to-accent/5' },
}

const MAX_VISIBLE = 3
const DEFAULT_DURATION_MS = 4_000

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const idRef = useRef(0)

  const dismiss = useCallback((id) => {
    setToasts(ts => ts.filter(t => t.id !== id))
  }, [])

  const show = useCallback((opts) => {
    const id = ++idRef.current
    const t = {
      id,
      kind: opts.kind ?? 'info',
      title: opts.title ?? null,
      body: typeof opts === 'string' ? opts : (opts.body ?? null),
      duration: opts.duration ?? DEFAULT_DURATION_MS,
    }
    setToasts(curr => {
      const next = [...curr, t]
      // Cap visible — drop oldest first when over budget.
      return next.length > MAX_VISIBLE ? next.slice(next.length - MAX_VISIBLE) : next
    })
    if (t.duration > 0) {
      setTimeout(() => dismiss(id), t.duration)
    }
    return id
  }, [dismiss])

  // Convenience helpers. Accept either a string (body only) or full opts.
  const success = useCallback((b)  => show(typeof b === 'string' ? { kind: 'success', body: b } : { kind: 'success', ...b }), [show])
  const error   = useCallback((b)  => show(typeof b === 'string' ? { kind: 'error',   body: b } : { kind: 'error',   ...b }), [show])
  const info    = useCallback((b)  => show(typeof b === 'string' ? { kind: 'info',    body: b } : { kind: 'info',    ...b }), [show])

  return (
    <ToastContext.Provider value={{ show, success, error, info, dismiss }}>
      {children}
      <Toaster toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}

export const useToast = () => {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside ToastProvider')
  return ctx
}

function Toaster({ toasts, onDismiss }) {
  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="fixed top-3 right-3 sm:top-4 sm:right-4 z-[60] flex flex-col gap-2 pointer-events-none w-full max-w-sm"
    >
      {toasts.map(t => (
        <ToastCard key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  )
}

function ToastCard({ toast, onDismiss }) {
  const { Icon, border, accent, bg } = KIND_META[toast.kind] ?? KIND_META.info
  return (
    <div
      role="status"
      className={`pointer-events-auto rounded-xl border ${border} bg-gradient-to-br ${bg} bg-surface backdrop-blur shadow-lift overflow-hidden animate-slide-up`}
    >
      <div className="flex items-start gap-3 p-3.5">
        <Icon size={18} strokeWidth={2} className={`${accent} shrink-0 mt-0.5`} aria-hidden="true" />
        <div className="flex-1 min-w-0">
          {toast.title && <div className="text-sm font-bold leading-tight">{toast.title}</div>}
          {toast.body && (
            <div className={`text-[13px] ${toast.title ? 'text-muted mt-0.5' : 'text-text'} leading-snug`}>
              {toast.body}
            </div>
          )}
        </div>
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 -mt-1 -mr-1 p-1 text-muted hover:text-text rounded hover:bg-surface2 transition"
        >
          <X size={14} strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}
