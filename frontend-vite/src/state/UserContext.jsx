import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { api, ApiError } from '../api'

// Real, session-cookie-backed auth state.
//
// `me`     — full user object from /api/auth/me, or null when signed out.
// `user`   — convenience handle string (or null). Keeps existing call sites
//            (`api.scoring(user)`, `<h1>{user}'s Portfolio</h1>`) working.
// `loading` — true while we're resolving the initial session check.
//
// All mutation goes through signIn / signUp / signOut, which update the
// context in a single flow so consumers don't need to refresh manually.

const UserContext = createContext(null)

export function UserProvider({ children }) {
  const [me, setMe] = useState(null)
  const [loading, setLoading] = useState(true)
  // Lifecycle action summary (claimable + needsProposal + openDisputes).
  // null = unloaded; null persists for signed-out users.
  const [actions, setActions] = useState(null)

  const refresh = useCallback(async () => {
    try {
      const { user } = await api.me()
      setMe(user ?? null)
    } catch (e) {
      // 401 just means no session — that's a valid logged-out state, not an error.
      if (!(e instanceof ApiError) || e.status !== 401) {
        console.error('auth refresh failed', e)
      }
      setMe(null)
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    refresh().finally(() => setLoading(false))
  }, [refresh])

  // Pull the lifecycle action summary whenever auth state flips into a
  // signed-in user, plus on window focus so a user returning to the tab
  // sees new claims/disputes without a hard refresh.
  const refreshActions = useCallback(async () => {
    if (!me) { setActions(null); return }
    try {
      const data = await api.actions()
      setActions(data)
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401) console.error('actions fetch failed', e)
    }
  }, [me])

  useEffect(() => { refreshActions() }, [refreshActions])
  useEffect(() => {
    if (!me) return
    const onFocus = () => { if (document.visibilityState === 'visible') refreshActions() }
    document.addEventListener('visibilitychange', onFocus)
    return () => document.removeEventListener('visibilitychange', onFocus)
  }, [me, refreshActions])

  const signIn = useCallback(async (handle, password) => {
    const { user } = await api.login(handle, password)
    setMe(user)
    return user
  }, [])

  const signUp = useCallback(async (handle, password, email) => {
    const { user } = await api.register(handle, password, email)
    setMe(user)
    return user
  }, [])

  const signInWithGoogle = useCallback(async (idToken) => {
    const { user } = await api.googleSignIn(idToken)
    setMe(user)
    return user
  }, [])

  const signOut = useCallback(async () => {
    try { await api.logout() } catch {} // best-effort; clear local state regardless
    setMe(null)
  }, [])

  const refreshBalance = useCallback(async () => {
    if (!me) return
    try {
      const { balance } = await api.balance()
      setMe(prev => prev ? { ...prev, chipsBalance: balance } : prev)
    } catch (e) {
      console.error('balance fetch failed', e)
    }
  }, [me])

  // Optimistic balance updates. The Buy/Sell flow decrements locally before
  // the API confirms so the modal can close instantly — the chips counter
  // in the header animates without waiting on the server round-trip. On
  // failure callers pass the negated delta to revert.
  const applyBalanceDelta = useCallback((delta) => {
    setMe(prev => prev ? { ...prev, chipsBalance: prev.chipsBalance + delta } : prev)
  }, [])

  // Reconcile to an authoritative balance from a trade response. Removes
  // the small drift between the optimistic stake debit and the actual LMSR
  // fill price.
  const setBalance = useCallback((balance) => {
    setMe(prev => prev ? { ...prev, chipsBalance: balance } : prev)
  }, [])

  // Locally stamp firstTradeAt so the new-user welcome card disappears the
  // instant the trade is fired, not after the /me round-trip. The server is
  // still the source of truth on next refresh.
  const markFirstTrade = useCallback(() => {
    setMe(prev => (prev && !prev.firstTradeAt) ? { ...prev, firstTradeAt: new Date().toISOString() } : prev)
  }, [])

  const claimBonus = useCallback(async () => {
    const result = await api.bonus()
    if (result.credited > 0) await refresh()
    else if (result.nextEligibleAt) {
      setMe(prev => prev ? { ...prev, nextBonusAt: result.nextEligibleAt } : prev)
    }
    return result
  }, [refresh])

  // Convenience derived values — keep both around so existing call sites
  // that used `user` as a handle string still work.
  const user = me?.handle ?? null
  const balance = me?.chipsBalance ?? 0
  const nextBonusAt = me?.nextBonusAt ?? null
  const isAdmin = me?.role === 'ADMIN'
  // Signed in but has never placed a trade — used to gate the welcome
  // card on Home and the first-trade explainer in BuyModal.
  const isNewUser = !!me && !me.firstTradeAt

  return (
    <UserContext.Provider value={{
      me, user, balance, nextBonusAt, isAdmin, isNewUser, loading,
      actions, refreshActions,
      signIn, signUp, signInWithGoogle, signOut, refresh, refreshBalance, claimBonus,
      applyBalanceDelta, setBalance, markFirstTrade,
    }}>
      {children}
    </UserContext.Provider>
  )
}

export const useUser = () => useContext(UserContext)
