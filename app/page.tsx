'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Post, Reply, DailyQuestion, Topic } from '@/lib/types'
import type { User } from '@supabase/supabase-js'

const TOPICS: { key: Topic; label: string }[] = [
  { key: 'all', label: 'all' },
  { key: 'relationships', label: 'relationships' },
  { key: 'loneliness', label: 'loneliness' },
  { key: 'work', label: 'work' },
  { key: 'family', label: 'family' },
  { key: 'identity', label: 'identity' },
  { key: 'loss', label: 'loss' },
  { key: 'other', label: 'other' },
]

function timeAgo(date: string) {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  return `${Math.floor(seconds / 86400)}d`
}

export default function Home() {
  const supabase = createClient()
  const [user, setUser] = useState<User | null>(null)
  const [posts, setPosts] = useState<Post[]>([])
  const [question, setQuestion] = useState<DailyQuestion | null>(null)
  const [topic, setTopic] = useState<Topic>('all')
  const [sort, setSort] = useState<'top' | 'recent'>('top')
  const [composerMode, setComposerMode] = useState<'free' | 'question'>('free')
  const [freeText, setFreeText] = useState('')
  const [questionText, setQuestionText] = useState('')
  const [freeTopic, setFreeTopic] = useState('relationships')
  const [search, setSearch] = useState('')
  const [expandedReplies, setExpandedReplies] = useState<Set<string>>(new Set())
  const [replies, setReplies] = useState<Record<string, Reply[]>>({})
  const [replyInputs, setReplyInputs] = useState<Record<string, string>>({})
  const [replyingTo, setReplyingTo] = useState<Record<string, string | null>>({})
  const [showModal, setShowModal] = useState(false)
  const [showUsernameModal, setShowUsernameModal] = useState(false)
  const [usernameInput, setUsernameInput] = useState('')
  const [usernameError, setUsernameError] = useState('')
  const [posting, setPosting] = useState(false)
  const [totalToday, setTotalToday] = useState(0)
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const PAGE_SIZE = 20

  useEffect(() => {
    async function checkUser(u: any) {
      setUser(u)
      if (!u) return
      const { data: profile } = await supabase.from('profiles').select('username').eq('id', u.id).single()
      if (!profile?.username) setShowUsernameModal(true)
    }
    supabase.auth.getUser().then(({ data }) => checkUser(data.user))
    supabase.auth.onAuthStateChange((_, session) => checkUser(session?.user ?? null))
    loadQuestion()
    loadPosts(0)
  }, [])

  useEffect(() => { setOffset(0); setPosts([]); setHasMore(true) }, [topic, sort, search])
  useEffect(() => { loadPosts(0) }, [topic, sort, search])

  async function loadQuestion() {
    const today = new Date().toISOString().split('T')[0]
    const { data } = await supabase.from('daily_questions').select('*').eq('date', today).single()
    if (data) setQuestion(data)
  }

  async function loadPosts(off: number) {
    let query = supabase.from('posts').select('*, profiles(username)')
    if (topic !== 'all') query = query.eq('topic', topic)
    if (search) query = query.ilike('content', `%${search}%`)
    query = sort === 'top'
      ? query.order('same_count', { ascending: false })
      : query.order('created_at', { ascending: false })
    const { data } = await query.range(off, off + PAGE_SIZE - 1)
    if (data) {
      if (off === 0) { setPosts(data as Post[]); setTotalToday(data.length) }
      else { setPosts(prev => { const updated = [...prev, ...data as Post[]]; setTotalToday(updated.length); return updated }) }
      setHasMore(data.length === PAGE_SIZE)
      setOffset(off + PAGE_SIZE)
    }
  }

  async function loadMore() { loadPosts(offset) }

  async function signInWithGoogle() {
    await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } })
  }

  async function saveUsername() {
    const u = usernameInput.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '')
    if (!u || u.length < 2) { setUsernameError('at least 2 characters'); return }
    if (u.length > 20) { setUsernameError('max 20 characters'); return }
    const { error } = await supabase.from('profiles').upsert({ id: user!.id, username: u })
    if (error?.code === '23505') { setUsernameError('already taken, try another'); return }
    if (error) { setUsernameError('something went wrong'); return }
    setShowUsernameModal(false)
    setUsernameInput('')
    setUsernameError('')
  }

  async function submitPost() {
    if (!user) { setShowModal(true); return }
    const content = composerMode === 'free' ? freeText : questionText
    if (!content.trim()) return
    setPosting(true)
    const { data } = await supabase.from('posts').insert({
      user_id: user.id, content: content.trim(),
      topic: composerMode === 'free' ? freeTopic : 'general',
      is_question_response: composerMode === 'question',
    }).select('*, profiles(username)').single()
    if (data) {
      setPosts(prev => [data as Post, ...prev])
      setTotalToday(prev => prev + 1)
      composerMode === 'free' ? setFreeText('') : setQuestionText('')
    }
    setPosting(false)
  }

  async function toggleReaction(postId: string, type: 'same' | 'damn') {
    if (!user) { setShowModal(true); return }
    const post = posts.find(p => p.id === postId)
    if (!post) return
    const key = `${type}_count` as 'same_count' | 'damn_count'
    if (post.user_reaction === type) {
      await supabase.from('reactions').delete().eq('post_id', postId).eq('user_id', user.id).eq('reaction_type', type)
      await supabase.from('posts').update({ [key]: Math.max(0, post[key] - 1) }).eq('id', postId)
      setPosts(prev => prev.map(p => p.id === postId ? { ...p, [key]: Math.max(0, p[key] - 1), user_reaction: null } : p))
    } else {
      await supabase.from('reactions').upsert({ post_id: postId, user_id: user.id, reaction_type: type })
      await supabase.from('posts').update({ [key]: post[key] + 1 }).eq('id', postId)
      setPosts(prev => prev.map(p => p.id === postId ? { ...p, [key]: p[key] + 1, user_reaction: type } : p))
    }
  }

  async function toggleReplies(postId: string) {
    const next = new Set(expandedReplies)
    if (next.has(postId)) { next.delete(postId) } else {
      next.add(postId)
      if (!replies[postId]) {
        const { data } = await supabase.from('replies').select('*, profiles(username)').eq('post_id', postId).order('created_at')
        if (data) setReplies(prev => ({ ...prev, [postId]: data as Reply[] }))
      }
    }
    setExpandedReplies(next)
  }

  async function submitReply(postId: string) {
    if (!user) { setShowModal(true); return }
    const content = replyInputs[postId]?.trim()
    if (!content) return
    const parentId = replyingTo[postId] || null
    const { data } = await supabase.from('replies').insert({ post_id: postId, user_id: user.id, content, parent_reply_id: parentId }).select('*, profiles(username)').single()
    if (data) {
      setReplies(prev => ({ ...prev, [postId]: [...(prev[postId] || []), data as Reply] }))
      setReplyInputs(prev => ({ ...prev, [postId]: '' }))
      setReplyingTo(prev => ({ ...prev, [postId]: null }))
      setPosts(prev => prev.map(p => p.id === postId ? { ...p, reply_count: p.reply_count + 1 } : p))
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>

      {/* Topbar */}
      <div style={{ borderBottom: '1px solid var(--border)', padding: '0 32px', height: 48, display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky' as const, top: 0, zIndex: 10, background: 'var(--bg)' }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 500, letterSpacing: '0.02em', color: 'var(--text)' }}>
          off record<span style={{ color: 'var(--accent)' }}>.</span>
        </div>
        <input
          style={{ position: 'absolute' as const, left: '50%', transform: 'translateX(-50%)', width: 220, background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)', padding: '4px 0', color: 'var(--text)', fontSize: 12, outline: 'none', textAlign: 'center' as const, fontFamily: 'var(--mono)' }}
          placeholder="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {user
            ? <button onClick={() => supabase.auth.signOut()} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer', fontFamily: 'var(--mono)' }}>sign out</button>
            : <>
                <button onClick={() => setShowModal(true)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer', fontFamily: 'var(--mono)' }}>sign in</button>
                <button onClick={() => setShowModal(true)} style={{ background: 'var(--accent)', border: 'none', padding: '5px 16px', color: '#fff', fontSize: 11, cursor: 'pointer', fontFamily: 'var(--mono)' }}>join</button>
              </>
          }
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '48px 32px', display: 'grid', gridTemplateColumns: '1fr 200px', gap: 64 }}>

        {/* Main */}
        <div>
          {/* Hero */}
          <div style={{ marginBottom: 40, paddingBottom: 32, borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--accent)', letterSpacing: '0.12em', marginBottom: 16, textTransform: 'uppercase' as const }}>off record</div>
            <h1 style={{ fontSize: 48, fontWeight: 300, lineHeight: 1.05, color: 'var(--text)', letterSpacing: '-0.02em' }}>
              say the thing.
            </h1>
          </div>

          {/* Composer */}
          <div style={{ marginBottom: 40, paddingBottom: 32, borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', gap: 0, marginBottom: 16, borderBottom: '1px solid var(--border)' }}>
              {(['free', 'question'] as const).map(mode => (
                <button key={mode} onClick={() => setComposerMode(mode)} style={{ padding: '8px 16px', fontSize: 11, fontFamily: 'var(--mono)', cursor: 'pointer', color: composerMode === mode ? 'var(--text)' : 'var(--text-muted)', border: 'none', background: composerMode === mode ? 'var(--surface2)' : 'none', borderBottom: composerMode === mode ? '1px solid var(--accent)' : '1px solid transparent', marginBottom: -1 }}>
                  {mode === 'free' ? 'post' : "today's q"}
                </button>
              ))}
            </div>

            {composerMode === 'question' && question && (
              <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text-dim)', marginBottom: 16, lineHeight: 1.6, padding: '12px 16px', background: 'var(--surface2)', borderLeft: '2px solid var(--accent)' }}>
                {question.question}
              </div>
            )}

            <textarea
              style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', padding: '12px 14px', color: 'var(--text)', fontSize: 14, resize: 'none', minHeight: 80, outline: 'none', lineHeight: 1.7, fontWeight: 300 }}
              placeholder="say it."
              value={composerMode === 'free' ? freeText : questionText}
              onChange={e => composerMode === 'free' ? setFreeText(e.target.value) : setQuestionText(e.target.value)}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10, gap: 12, alignItems: 'center' }}>
              {composerMode === 'free' && (
                <select style={{ background: 'var(--surface)', border: '1px solid var(--border)', padding: '5px 8px', color: 'var(--text-muted)', fontSize: 11, outline: 'none', fontFamily: 'var(--mono)' }} value={freeTopic} onChange={e => setFreeTopic(e.target.value)}>
                  {TOPICS.filter(t => t.key !== 'all').map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                </select>
              )}
              <button onClick={submitPost} style={{ background: 'var(--accent)', border: 'none', padding: '6px 20px', color: '#fff', fontSize: 11, fontFamily: 'var(--mono)', cursor: 'pointer' }}>
                {posting ? '...' : 'post'}
              </button>
            </div>
          </div>

          {/* Feed controls */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.08em' }}>{totalToday} posts</span>
            <div style={{ display: 'flex', gap: 0, border: '1px solid var(--border)' }}>
              {(['top', 'recent'] as const).map(s => (
                <button key={s} onClick={() => setSort(s)} style={{ padding: '4px 14px', fontSize: 10, fontFamily: 'var(--mono)', cursor: 'pointer', color: sort === s ? 'var(--text)' : 'var(--text-muted)', border: 'none', background: sort === s ? 'var(--surface2)' : 'transparent' }}>
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Posts */}
          <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 0 }}>
            {posts.map(post => (
              <div key={post.id} style={{ padding: '24px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-muted)' }}>{post.profiles?.username} · {timeAgo(post.created_at)}</span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--accent)', letterSpacing: '0.06em' }}>{post.topic}</span>
                </div>

                <div style={{ fontSize: 14, lineHeight: 1.75, color: 'var(--text)', marginBottom: 16, fontWeight: 300 }}>
                  {post.content}
                </div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {(['same', 'damn'] as const).map(type => (
                    <button key={type} onClick={() => toggleReaction(post.id, type)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 10px', border: post.user_reaction === type ? '1px solid var(--accent)' : '1px solid var(--border)', background: post.user_reaction === type ? 'var(--accent-dim)' : 'none', color: post.user_reaction === type ? 'var(--accent)' : 'var(--text-muted)', fontSize: 10, fontFamily: 'var(--mono)', cursor: 'pointer' }}>
                      {type} <span>{post[`${type}_count`]}</span>
                    </button>
                  ))}
                  <button onClick={() => toggleReplies(post.id)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 10, fontFamily: 'var(--mono)', cursor: 'pointer' }}>
                    {expandedReplies.has(post.id) ? 'hide' : `${post.reply_count} replies`}
                  </button>
                </div>

                {expandedReplies.has(post.id) && (
                  <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 16, marginBottom: 16 }}>
                      {(replies[post.id] || []).map(r => (
                        <div key={r.id} style={{ paddingLeft: r.parent_reply_id ? 20 : 0, borderLeft: r.parent_reply_id ? '2px solid var(--border2)' : 'none' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                            <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-muted)' }}>{r.profiles?.username}</span>
                            <button onClick={() => setReplyingTo(prev => ({ ...prev, [post.id]: prev[post.id] === r.id ? null : r.id }))} style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>reply</button>
                          </div>
                          <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.65, fontWeight: 300 }}>{r.content}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                      <input
                        style={{ flex: 1, background: 'var(--surface)', border: '1px solid var(--border)', padding: '6px 10px', color: 'var(--text)', fontSize: 12, outline: 'none' }}
                        placeholder={replyingTo[post.id] ? 'replying...' : 'reply...'}
                        value={replyInputs[post.id] || ''}
                        onChange={e => setReplyInputs(p => ({ ...p, [post.id]: e.target.value }))}
                        onKeyDown={e => e.key === 'Enter' && submitReply(post.id)}
                      />
                      <button onClick={() => submitReply(post.id)} style={{ background: 'none', border: '1px solid var(--border)', padding: '6px 14px', color: 'var(--text-muted)', fontSize: 10, fontFamily: 'var(--mono)', cursor: 'pointer' }}>send</button>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {hasMore && (
              <button onClick={loadMore} style={{ width: '100%', padding: '16px', background: 'none', border: 'none', borderTop: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: 10, fontFamily: 'var(--mono)', letterSpacing: '0.1em', cursor: 'pointer' }}>
                load more
              </button>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div>
          <div style={{ position: 'sticky' as const, top: 64, display: 'flex', flexDirection: 'column' as const, gap: 36 }}>
            <div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.14em', color: 'var(--text-muted)', marginBottom: 12, textTransform: 'uppercase' as const }}>about</div>
              <p style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.8, marginBottom: 4, fontWeight: 300 }}>A space for men to say the things they never say out loud.</p>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.7, marginBottom: 16, fontWeight: 300 }}>Everyone&apos;s welcome to sit with it.</p>
              <button onClick={() => setShowModal(true)} style={{ width: '100%', background: 'var(--accent)', border: 'none', padding: '8px', color: '#fff', fontSize: 10, fontFamily: 'var(--mono)', letterSpacing: '0.1em', cursor: 'pointer' }}>
                join
              </button>
            </div>

            <div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.14em', color: 'var(--text-muted)', marginBottom: 12, textTransform: 'uppercase' as const }}>today</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-muted)' }}>posts</span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 14, color: 'var(--text)' }}>{totalToday}</span>
              </div>
            </div>

            <div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.14em', color: 'var(--text-muted)', marginBottom: 12, textTransform: 'uppercase' as const }}>topics</div>
              <div style={{ display: 'flex', flexDirection: 'column' as const }}>
                {TOPICS.map(t => (
                  <button key={t.key} onClick={() => setTopic(t.key)} style={{ textAlign: 'left' as const, padding: '7px 0', fontFamily: 'var(--mono)', fontSize: 11, color: topic === t.key ? 'var(--accent)' : 'var(--text-muted)', background: 'none', border: 'none', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}>
                    {topic === t.key ? '> ' : '  '}{t.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
              {[['privacy', '/privacy'], ['terms', '/terms'], ['contact', 'mailto:hello@off-record.app']].map(([label, href]) => (
                <a key={label} href={href} style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-muted)', textDecoration: 'none' }}>{label}</a>
              ))}
              <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-muted)', marginTop: 4 }}>© 2025</span>
            </div>
          </div>
        </div>
      </div>

      {showUsernameModal && (
        <div style={{ position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', padding: '40px 36px', maxWidth: 360, width: '100%' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--accent)', letterSpacing: '0.1em', marginBottom: 12 }}>one last thing.</div>
            <div style={{ fontSize: 20, fontWeight: 300, marginBottom: 8, color: 'var(--text)' }}>choose your name.</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-muted)', marginBottom: 24, lineHeight: 1.6 }}>this is how you appear. no real name. ever.</div>
            <input
              style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', padding: '10px 12px', color: 'var(--text)', fontSize: 13, outline: 'none', marginBottom: 8, fontFamily: 'var(--mono)' }}
              placeholder="e.g. coldstatic, ryan1987, drifting42"
              value={usernameInput}
              onChange={e => { setUsernameInput(e.target.value); setUsernameError('') }}
              onKeyDown={e => e.key === 'Enter' && saveUsername()}
              autoFocus
            />
            {usernameError && <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--accent)', marginBottom: 8 }}>{usernameError}</div>}
            <button onClick={saveUsername} style={{ width: '100%', background: 'var(--accent)', border: 'none', padding: '10px', color: '#fff', fontSize: 11, fontFamily: 'var(--mono)', letterSpacing: '0.1em', cursor: 'pointer' }}>
              set name
            </button>
          </div>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div style={{ position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 99 }} onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', padding: '40px 36px', maxWidth: 360, width: '100%' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--accent)', letterSpacing: '0.1em', marginBottom: 12 }}>off record.</div>
            <div style={{ fontSize: 22, fontWeight: 300, marginBottom: 8, color: 'var(--text)', lineHeight: 1.2 }}>why are you here?</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-muted)', marginBottom: 28, lineHeight: 1.6 }}>no judgment. stays private.</div>
            <button onClick={signInWithGoogle} style={{ width: '100%', background: 'var(--accent)', border: 'none', padding: '11px', color: '#fff', fontSize: 11, fontFamily: 'var(--mono)', letterSpacing: '0.08em', cursor: 'pointer', marginBottom: 12 }}>
              continue with Google
            </button>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-muted)', textAlign: 'center' as const }}>no real name shown · ever</div>
          </div>
        </div>
      )}
    </div>
  )
}
