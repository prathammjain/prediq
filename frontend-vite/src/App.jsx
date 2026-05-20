import React, { lazy, Suspense } from 'react'
import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout.jsx'
import Protected from './components/Protected.jsx'
// Home is the landing page; bundle it eagerly so first paint never waits on
// a chunk fetch. Every other page is code-split into its own chunk and
// loaded on first navigation. Cuts ~60% off the initial JS payload on cold
// loads, which is the dominant cost on mobile networks.
import Home from './pages/Home.jsx'

const MarketDetail = lazy(() => import('./pages/MarketDetail.jsx'))
const Portfolio    = lazy(() => import('./pages/Portfolio.jsx'))
const Leaderboard  = lazy(() => import('./pages/Leaderboard.jsx'))
const CreateMarket = lazy(() => import('./pages/CreateMarket.jsx'))
const AdminDrafts  = lazy(() => import('./pages/AdminDrafts.jsx'))
const Login        = lazy(() => import('./pages/Login.jsx'))
const Signup       = lazy(() => import('./pages/Signup.jsx'))
const NotFound     = lazy(() => import('./pages/NotFound.jsx'))

// Generic shell while a route chunk streams in. Matches the skeleton
// language used elsewhere so the transition feels native, not loading-y.
function RouteFallback() {
  return (
    <div className="space-y-4 animate-fade-in">
      <div className="skeleton h-8 w-48 rounded" />
      <div className="skeleton h-64 rounded-2xl" />
    </div>
  )
}

export default function App() {
  return (
    <Layout>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          {/* Public */}
          <Route path="/" element={<Home />} />
          <Route path="/market/:id" element={<MarketDetail />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />

          {/* Authenticated */}
          <Route path="/portfolio" element={<Protected><Portfolio /></Protected>} />
          <Route path="/create"    element={<Protected><CreateMarket /></Protected>} />

          {/* Admin only */}
          <Route path="/admin/drafts" element={<Protected adminOnly><AdminDrafts /></Protected>} />

          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </Layout>
  )
}
