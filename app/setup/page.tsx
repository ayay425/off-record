'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function Setup() {
  const supabase = createClient()
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) { router.push('/'); return }
      const { data: profile } = await supabase.from('profiles').select('username').eq('id', data.user.id).maybeSingle()
      if (profile?.username) { router.push('/'); return }
      setLoading(false)
    })
  }, [])

  async function save() {
    const u = username.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '')
    if (!u || u.length < 2) { setError('at least 2 characters'); return }
    if (u.length > 20) { setError('max 20 characters'); return }
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { error: err } = await supabase.from('profiles').upsert({ id: user.id, username: u })
    if (err?.code === '23505') { setError('already taken'); return }
    if (err) { setError('something went wrong'); return }
    router.push('/')
  }

  if (loading) return <div style={{ minHeight: '100vh', background: '#0c0c0c' }} />

  return (
    <div style={{ minHeight: '100vh', background: '#0c0c0c', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#141414', border: '1px solid #282828', padding: '40px 36px', maxWidth: 360, width: '100%' }}>
        <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#c0392b', letterSpacing: '0.1em', marginBottom: 12 }}>one last thing.</div>
        <div style={{ fontSize: 20, fontWeight: 300, marginBottom: 8, color: '#e4e4e4' }}>choose your name.</div>
        <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#484848', marginBottom: 24, lineHeight: 1.6 }}>this is how you appear. no real name. ever.</div>
        <input
          style={{ width: '100%', background: '#1c1c1c', border: '1px solid #282828', padding: '10px 12px', color: '#e4e4e4', fontSize: 13, outline: 'none', marginBottom: 8, fontFamily: 'monospace' }}
          placeholder="e.g. coldstatic, ryan1987, drifting42"
          value={username}
          onChange={e => { setUsername(e.target.value); setError('') }}
          onKeyDown={e => e.key === 'Enter' && save()}
          autoFocus
        />
        {error && <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#c0392b', marginBottom: 8 }}>{error}</div>}
        <button onClick={save} style={{ width: '100%', background: '#c0392b', border: 'none', padding: '10px', color: '#fff', fontSize: 11, fontFamily: 'monospace', letterSpacing: '0.1em', cursor: 'pointer' }}>
          set name
        </button>
      </div>
    </div>
  )
}
