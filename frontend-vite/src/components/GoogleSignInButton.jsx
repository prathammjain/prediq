import React, { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { useUser } from '../state/UserContext.jsx'
import { useToast } from '../state/ToastContext.jsx'

// Google Identity Services button. Renders Google's official button via
// `accounts.id.renderButton`, gets an ID token in the credential callback,
// and exchanges it for a predIQ session via /api/auth/google.
//
// We load the GIS script on-demand (one shared promise across the page) so
// the auth pages stay snappy and the script never loads for users that
// never see this button.
//
// Hidden entirely when GOOGLE_CLIENT_ID isn't configured server-side.

const GIS_SRC = 'https://accounts.google.com/gsi/client'
let gisScriptPromise = null
function loadGoogleIdentityServices() {
  if (typeof window === 'undefined') return Promise.reject(new Error('SSR'))
  if (window.google?.accounts?.id) return Promise.resolve(window.google)
  if (gisScriptPromise) return gisScriptPromise
  gisScriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = GIS_SRC
    s.async = true
    s.defer = true
    s.onload = () => {
      if (window.google?.accounts?.id) resolve(window.google)
      else reject(new Error('GIS loaded but window.google missing'))
    }
    s.onerror = () => reject(new Error('Failed to load Google Identity Services'))
    document.head.appendChild(s)
  })
  return gisScriptPromise
}

export default function GoogleSignInButton({ onSignedIn }) {
  const { signInWithGoogle } = useUser()
  const toast = useToast()
  const containerRef = useRef(null)
  const [providerState, setProviderState] = useState({ loading: true, enabled: false, clientId: null })
  const [err, setErr] = useState(null)

  // Discover whether Google sign-in is configured server-side.
  useEffect(() => {
    let cancelled = false
    api.authProviders()
      .then(p => { if (!cancelled) setProviderState({ loading: false, ...p.google }) })
      .catch(() => { if (!cancelled) setProviderState({ loading: false, enabled: false, clientId: null }) })
    return () => { cancelled = true }
  }, [])

  // Render Google's button once the script is loaded and we know the client id.
  useEffect(() => {
    if (!providerState.enabled || !providerState.clientId || !containerRef.current) return
    let disposed = false

    loadGoogleIdentityServices()
      .then((google) => {
        if (disposed || !containerRef.current) return
        google.accounts.id.initialize({
          client_id: providerState.clientId,
          callback: async ({ credential }) => {
            try {
              const user = await signInWithGoogle(credential)
              toast.success(`Welcome, ${user.handle}.`)
              onSignedIn?.(user)
            } catch (e) {
              setErr(e?.message ?? 'Google sign-in failed.')
              toast.error(e?.message ?? 'Google sign-in failed.')
            }
          },
          ux_mode: 'popup',
          auto_select: false,
        })
        google.accounts.id.renderButton(containerRef.current, {
          type: 'standard',
          theme: 'filled_black',
          size: 'large',
          text: 'continue_with',
          shape: 'rectangular',
          logo_alignment: 'left',
          width: 320,
        })
      })
      .catch((e) => {
        if (!disposed) setErr(e?.message ?? 'Could not load Google sign-in.')
      })

    return () => { disposed = true }
  }, [providerState, signInWithGoogle, toast, onSignedIn])

  // Hide entirely when not configured — keeps the auth page clean. Loading
  // state stays sized so the form doesn't visibly jump on first render.
  if (providerState.loading) {
    return <div className="h-11 rounded-lg bg-surface2/40 animate-pulse-soft" aria-hidden="true" />
  }
  if (!providerState.enabled) return null

  return (
    <div className="space-y-3">
      <Divider />
      <div ref={containerRef} className="flex justify-center min-h-[44px]" />
      {err && (
        <div className="rounded-lg bg-no/10 border border-no/40 px-3 py-2 text-xs text-no animate-pop">
          {err}
        </div>
      )}
    </div>
  )
}

const Divider = () => (
  <div className="flex items-center gap-3" aria-hidden="true">
    <div className="flex-1 h-px bg-border" />
    <span className="text-[10px] uppercase tracking-widest text-muted/70 font-semibold">or</span>
    <div className="flex-1 h-px bg-border" />
  </div>
)
