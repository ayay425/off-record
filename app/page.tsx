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
  const [posting, setPosting] = useState(false)
  const [totalToday, setTotalToday] = useState(0)
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const PAGE_SIZE = 20

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user))
    supabase.auth.onAuthStateChange((_, session) => setUser(session?.user ?? null))
    loadQuestion()
    loadPosts(0)
  }, [])

  useEffect(() => { setOffset(0); setPosts([]); setHasMore(true); }, [topic, sort, search])
  useEffect(() => { if (offset === 0 && posts.length === 0) loadPosts(0) }, [offset, posts.length])

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
      <div style={{ background: 'var(--bg)', borderBottom: '1px solid var(--border)', padding: '0 40px', height: 56, display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ fontFamily: 'var(--serif)', fontSize: 16, fontWeight: 400, letterSpacing: '0.04em', color: 'var(--text)' }}>
          off record<span style={{ color: 'var(--accent)' }}>.</span>
        </div>
        <div style={{ flex: 1, maxWidth: 280, margin: '0 40px', position: 'relative' }}>
          <input
            style={{ width: '100%', background: 'transparent', border: 'none', borderBottom: '1px solid var(--border2)', padding: '6px 0', color: 'var(--text)', fontSize: 13, outline: 'none', letterSpacing: '0.02em' }}
            placeholder="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div>
          {user
            ? <button onClick={() => supabase.auth.signOut()} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer', letterSpacing: '0.08em' }}>sign out</button>
            : <button onClick={() => setShowModal(true)} style={{ background: 'none', border: '1px solid var(--border2)', padding: '7px 20px', color: 'var(--text-dim)', fontSize: 12, cursor: 'pointer', letterSpacing: '0.08em', borderRadius: 2 }}>join</button>
          }
        </div>
      </div>

      <div style={{ maxWidth: 1160, margin: '0 auto', padding: '0 40px', display: 'grid', gridTemplateColumns: '1fr 220px', gap: 60, paddingTop: 60 }}>
        {/* Main */}
        <div>
          {/* Hero */}
          <div style={{ marginBottom: 48, borderBottom: '1px solid var(--border)', paddingBottom: 40 }}>
            <h1 style={{ fontFamily: 'var(--serif)', fontSize: 56, fontWeight: 400, fontStyle: 'italic', lineHeight: 1, color: 'var(--text)', letterSpacing: '-0.01em', marginBottom: 0 }}>
              say the thing.
            </h1>
          </div>

          {/* Composer */}
          <div style={{ marginBottom: 48, border: '1px solid var(--border)', borderRadius: 4 }}>
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
              {(['free', 'question'] as const).map(mode => (
                <button key={mode} onClick={() => setComposerMode(mode)} style={{ flex: 1, padding: '12px 16px', fontSize: 12, fontWeight: 400, letterSpacing: '0.08em', cursor: 'pointer', color: composerMode === mode ? 'var(--text)' : 'var(--text-muted)', border: 'none', background: 'none', borderBottom: composerMode === mode ? '1px solid var(--accent)' : '1px solid transparent', marginBottom: -1 }}>
                  {mode === 'free' ? 'post something' : "today's question"}
                </button>
              ))}
            </div>
            <div style={{ padding: '20px' }}>
              {composerMode === 'question' && question && (
                <div style={{ fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: 15, color: 'var(--text-dim)', marginBottom: 16, lineHeight: 1.6, borderLeft: '2px solid var(--accent)', paddingLeft: 16 }}>
                  {question.question}
                </div>
              )}
              <textarea
                style={{ width: '100%', background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)', padding: '8px 0', color: 'var(--text)', fontSize: 14, resize: 'none', minHeight: 80, outline: 'none', lineHeight: 1.7, letterSpacing: '0.01em' }}
                placeholder="say it."
                value={composerMode === 'free' ? freeText : questionText}
                onChange={e => composerMode === 'free' ? setFreeText(e.target.value) : setQuestionText(e.target.value)}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16, gap: 12, alignItems: 'center' }}>
                {composerMode === 'free' && (
                  <select style={{ background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)', padding: '4px 0', color: 'var(--text-muted)', fontSize: 12, outline: 'none', letterSpacing: '0.06em' }} value={freeTopic} onChange={e => setFreeTopic(e.target.value)}>
                    {TOPICS.filter(t => t.key !== 'all').map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                  </select>
                )}
                <button onClick={submitPost} style={{ background: 'var(--accent)', border: 'none', padding: '8px 24px', color: '#fff', fontSize: 12, letterSpacing: '0.1em', cursor: 'pointer', borderRadius: 2 }}>
                  {posting ? '...' : 'post'}
                </button>
              </div>
            </div>
          </div>

          {/* Feed header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
            <div style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--text-muted)', textTransform: 'uppercase' as const }}>{totalToday} posts</div>
            <div style={{ display: 'flex', gap: 0, border: '1px solid var(--border)', borderRadius: 2, overflow: 'hidden' }}>
              {(['top', 'recent'] as const).map(s => (
                <button key={s} onClick={() => setSort(s)} style={{ padding: '5px 16px', fontSize: 11, letterSpacing: '0.08em', cursor: 'pointer', color: sort === s ? 'var(--text)' : 'var(--text-muted)', border: 'none', background: sort === s ? 'var(--surface2)' : 'transparent' }}>
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Posts */}
          <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 1 }}>
            {posts.map((post, i) => (
              <div key={post.id} style={{ background: 'var(--surface)', borderTop: i === 0 ? '1px solid var(--border)' : 'none', borderBottom: '1px solid var(--border)', padding: '24px 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.06em' }}>{post.profiles?.username} · {timeAgo(post.created_at)}</span>
                  <span style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--accent)', fontWeight: 500 }}>{post.topic}</span>
                </div>
                <div style={{ fontSize: 15, lineHeight: 1.75, color: 'var(--text)', letterSpacing: '0.01em', marginBottom: 20, fontWeight: 300 }}>{post.content}</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {(['same', 'damn'] as const).map(type => (
                    <button key={type} onClick={() => toggleReaction(post.id, type)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 14px', border: post.user_reaction === type ? '1px solid var(--accent)' : '1px solid var(--border)', background: 'none', color: post.user_reaction === type ? 'var(--accent)' : 'var(--text-muted)', fontSize: 11, letterSpacing: '0.08em', cursor: 'pointer', borderRadius: 2 }}>
                      <span>{type}</span><span style={{ fontWeight: 500 }}>{post[`${type}_count`]}</span>
                    </button>
                  ))}
                  <button onClick={() => toggleReplies(post.id)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 11, letterSpacing: '0.08em', cursor: 'pointer' }}>
                    {expandedReplies.has(post.id) ? 'hide' : `${post.reply_count} ${post.reply_count === 1 ? 'reply' : 'replies'}`}
                  </button>
                </div>

                {expandedReplies.has(post.id) && (
                  <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 16, marginBottom: 16 }}>
                      {(replies[post.id] || []).map(r => (
                        <div key={r.id} style={{ paddingLeft: r.parent_reply_id ? 24 : 0, borderLeft: r.parent_reply_id ? '1px solid var(--border2)' : 'none' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                            <span style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.04em' }}>{r.profiles?.username}</span>
                            <button onClick={() => setReplyingTo(prev => ({ ...prev, [post.id]: prev[post.id] === r.id ? null : r.id }))} style={{ fontSize: 10, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', letterSpacing: '0.06em' }}>reply</button>
                          </div>
                          <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.65, fontWeight: 300 }}>{r.content}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                      <input
                        style={{ flex: 1, background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)', padding: '6px 0', color: 'var(--text)', fontSize: 13, outline: 'none', letterSpacing: '0.01em' }}
                        placeholder={replyingTo[post.id] ? 'replying...' : 'reply...'}
                        value={replyInputs[post.id] || ''}
                        onChange={e => setReplyInputs(p => ({ ...p, [post.id]: e.target.value }))}
                        onKeyDown={e => e.key === 'Enter' && submitReply(post.id)}
                      />
                      <button onClick={() => submitReply(post.id)} style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 12, letterSpacing: '0.08em', cursor: 'pointer' }}>send</button>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {hasMore && (
              <button onClick={loadMore} style={{ width: '100%', padding: '16px', marginTop: 16, background: 'none', border: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase' as const, cursor: 'pointer', borderRadius: 2 }}>
                load more
              </button>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 40, paddingTop: 4 }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: 'var(--text-muted)', marginBottom: 12 }}>about</div>
            <div style={{ width: 24, height: 1, background: 'var(--accent)', marginBottom: 16 }} />
            <p style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.8, marginBottom: 6, fontWeight: 300 }}>A space for men to say the things they never say out loud.</p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7, marginBottom: 20, fontWeight: 300 }}>Everyone&apos;s welcome to sit with it.</p>
            <button onClick={() => setShowModal(true)} style={{ width: '100%', background: 'var(--accent)', border: 'none', padding: '10px', color: '#fff', fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase' as const, cursor: 'pointer', borderRadius: 2 }}>
              join
            </button>
          </div>

          <div>
            <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: 'var(--text-muted)', marginBottom: 12 }}>today</div>
            <div style={{ width: 24, height: 1, background: 'var(--border2)', marginBottom: 16 }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>posts</span>
              <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', fontFamily: 'var(--serif)' }}>{totalToday}</span>
            </div>
          </div>

          <div>
            <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: 'var(--text-muted)', marginBottom: 12 }}>topics</div>
            <div style={{ width: 24, height: 1, background: 'var(--border2)', marginBottom: 16 }} />
            <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 2 }}>
              {TOPICS.map(t => (
                <button key={t.key} onClick={() => setTopic(t.key)} style={{ textAlign: 'left' as const, padding: '7px 0', fontSize: 12, color: topic === t.key ? 'var(--text)' : 'var(--text-dim)', background: 'none', border: 'none', cursor: 'pointer', letterSpacing: '0.04em', fontWeight: topic === t.key ? 500 : 300, borderBottom: topic === t.key ? '1px solid var(--accent)' : '1px solid transparent' }}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ paddingTop: 16, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
            {[['privacy', '/privacy'], ['terms', '/terms'], ['contact', 'mailto:hello@off-record.app']].map(([label, href]) => (
              <a key={label} href={href} style={{ fontSize: 11, color: 'var(--text-muted)', textDecoration: 'none', letterSpacing: '0.06em' }}>{label}</a>
            ))}
            <span style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.06em', marginTop: 4 }}>© 2025</span>
          </div>
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <div style={{ position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 99, padding: 20 }} onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', padding: '48px 40px', maxWidth: 360, width: '100%', borderRadius: 4 }}>
            <div style={{ fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: 24, marginBottom: 8, color: 'var(--text)' }}>why are you here?</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 32, lineHeight: 1.6, fontWeight: 300 }}>no judgment. stays private.</div>
            <button onClick={signInWithGoogle} style={{ width: '100%', background: 'var(--accent)', border: 'none', padding: '12px', color: '#fff', fontSize: 12, letterSpacing: '0.1em', cursor: 'pointer', marginBottom: 16, borderRadius: 2 }}>
              continue with Google
            </button>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' as const, letterSpacing: '0.06em' }}>no real name shown · ever</div>
          </div>
        </div>
      )}
    </div>
  )
}
