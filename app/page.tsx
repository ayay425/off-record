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
  const [showModal, setShowModal] = useState(false)
  const [showUsernameModal, setShowUsernameModal] = useState(false)
  const [tempUsername, setTempUsername] = useState('')
  const [usernameError, setUsernameError] = useState('')
  const [posting, setPosting] = useState(false)
  const [totalToday, setTotalToday] = useState(0)
  const [hasCheckedUsername, setHasCheckedUsername] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setUser(data.user)
        checkAndPromptUsername(data.user.id)
      }
    })
    supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null)
      if (session?.user) {
        checkAndPromptUsername(session.user.id)
      }
    })
    loadQuestion()
  }, [])

  useEffect(() => { loadPosts() }, [topic, sort, search])

  async function checkAndPromptUsername(userId: string) {
    const { data } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('id', userId)
      .single()
    
    if (!data?.display_name) {
      setShowUsernameModal(true)
    }
    setHasCheckedUsername(true)
  }

  async function saveUsername() {
    if (!tempUsername.trim()) {
      setUsernameError('Username cannot be empty')
      return
    }
    if (!/^[a-zA-Z0-9]+$/.test(tempUsername)) {
      setUsernameError('Use only letters and numbers, no spaces or underscores')
      return
    }
    if (tempUsername.length < 3 || tempUsername.length > 20) {
      setUsernameError('Username must be 3-20 characters')
      return
    }

    const { error } = await supabase
      .from('profiles')
      .update({ display_name: tempUsername.toLowerCase() })
      .eq('id', user?.id)

    if (error) {
      if (error.code === '23505') {
        setUsernameError('Username already taken, try another')
      } else {
        setUsernameError('Something went wrong, try again')
      }
      return
    }

    setShowUsernameModal(false)
    setTempUsername('')
    setUsernameError('')
  }

  async function loadQuestion() {
    const today = new Date().toISOString().split('T')[0]
    const { data } = await supabase.from('daily_questions').select('*').eq('date', today).single()
    if (data) setQuestion(data)
  }

  async function loadPosts() {
    let query = supabase
      .from('posts')
      .select(`
        id,
        content,
        topic,
        same_count,
        damn_count,
        reply_count,
        created_at,
        user_id,
        is_question_response,
        profiles (
          display_name,
          username
        )
      `)
    
    if (topic !== 'all') query = query.eq('topic', topic)
    if (search) query = query.ilike('content', `%${search}%`)
    
    if (sort === 'top') {
      query = query.order('same_count', { ascending: false })
    } else {
      query = query.order('created_at', { ascending: false })
    }
    
    const { data, error } = await query

    if (error) {
      console.error('Error loading posts:', error)
      return
    }
    
    if (data) {
      setPosts(data as unknown as Post[])
      setTotalToday(data.length)
    }
  }

  async function signInWithGoogle() {
    await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } })
  }

  async function submitPost() {
    if (!user) { setShowModal(true); return }
    const content = composerMode === 'free' ? freeText : questionText
    if (!content.trim()) return
    setPosting(true)
    const { data } = await supabase.from('posts').insert({
      user_id: user.id,
      content: content.trim(),
      topic: composerMode === 'free' ? freeTopic : 'general',
      is_question_response: composerMode === 'question',
    }).select()
    if (data) {
      loadPosts()
      composerMode === 'free' ? setFreeText('') : setQuestionText('')
    }
    setPosting(false)
  }

  async function toggleReaction(postId: string, type: 'same' | 'damn') {
    if (!user) return
    const post = posts.find(p => p.id === postId)
    if (!post) return
    const key = `${type}_count` as 'same_count' | 'damn_count'
    
    if ((post as any).user_reaction === type) {
      await supabase.from('reactions').delete().eq('post_id', postId).eq('user_id', user.id).eq('reaction_type', type)
      await supabase.from('posts').update({ [key]: Math.max(0, (post[key] as number) - 1) }).eq('id', postId)
    } else {
      await supabase.from('reactions').upsert({ post_id: postId, user_id: user.id, reaction_type: type })
      await supabase.from('posts').update({ [key]: (post[key] as number) + 1 }).eq('id', postId)
    }
    loadPosts()
  }

  async function toggleReplies(postId: string) {
    const next = new Set(expandedReplies)
    if (next.has(postId)) { next.delete(postId) } else {
      next.add(postId)
      if (!replies[postId]) {
        const { data } = await supabase.from('replies').select('*, profiles(display_name, username)').eq('post_id', postId).order('created_at')
        if (data) setReplies(prev => ({ ...prev, [postId]: data as Reply[] }))
      }
    }
    setExpandedReplies(next)
  }

  async function submitReply(postId: string) {
    if (!user) { setShowModal(true); return }
    const content = replyInputs[postId]?.trim()
    if (!content) return
    const { data } = await supabase.from('replies').insert({ post_id: postId, user_id: user.id, content }).select('*, profiles(display_name, username)').single()
    if (data) {
      setReplies(prev => ({ ...prev, [postId]: [...(prev[postId] || []), data as Reply] }))
      setReplyInputs(prev => ({ ...prev, [postId]: '' }))
      loadPosts()
    }
  }

  const c = {
    topbar: { background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '0 24px', height: 52, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, position: 'sticky' as const, top: 0, zIndex: 10 },
    logo: { fontSize: 14, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase' as const, color: 'var(--text)', whiteSpace: 'nowrap' as const },
    dot: { color: 'var(--accent)' },
    searchWrap: { flex: 1, maxWidth: 240, position: 'relative' as const },
    searchInput: { width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 12px 7px 32px', color: 'var(--text)', fontSize: 13, outline: 'none' },
    searchIcon: { position: 'absolute' as const, left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: 'var(--text-muted)', pointerEvents: 'none' as const },
    navBtns: { display: 'flex', gap: 8, alignItems: 'center' },
    btnGhost: { padding: '6px 16px', fontSize: 13, fontWeight: 500, borderRadius: 6, border: '1px solid var(--border2)', background: 'none', color: 'var(--text-dim)', cursor: 'pointer' },
    btnPrimary: { padding: '6px 16px', fontSize: 13, fontWeight: 600, borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer' },
    main: { maxWidth: 1100, margin: '0 auto', padding: '24px', display: 'grid', gridTemplateColumns: '1fr 196px', gap: 24 },
    h1: { fontSize: 36, fontWeight: 700, lineHeight: 1.05, color: 'var(--text)', letterSpacing: '-0.02em', paddingBottom: 20, borderBottom: '1px solid var(--border)', marginBottom: 20 },
    composer: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, marginBottom: 16, overflow: 'hidden' },
    ctab: (active: boolean) => ({ flex: 1, padding: '11px 14px', fontSize: 13, fontWeight: 500, cursor: 'pointer', color: active ? 'var(--text)' : 'var(--text-muted)', border: 'none', background: 'none', borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent', marginBottom: -1, textAlign: 'center' as const }),
    composerBody: { padding: '14px 16px' },
    qLabel: { fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--text-muted)', marginBottom: 8 },
    qText: { fontSize: 14, color: 'var(--text-dim)', lineHeight: 1.5, marginBottom: 12 },
    textarea: { width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '10px 14px', color: 'var(--text)', fontSize: 14, resize: 'none' as const, minHeight: 76, outline: 'none', lineHeight: 1.6 },
    postRow: { display: 'flex', justifyContent: 'flex-end', marginTop: 10, gap: 8, alignItems: 'center' },
    select: { background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', color: 'var(--text-dim)', fontSize: 12, outline: 'none' },
    feedHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
    feedLabel: { fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: 'var(--text-muted)' },
    tab: (active: boolean) => ({ padding: '5px 12px', fontSize: 12, fontWeight: 500, cursor: 'pointer', color: active ? 'var(--text)' : 'var(--text-muted)', border: 'none', background: active ? 'var(--surface2)' : 'none' }),
    feed: { display: 'flex', flexDirection: 'column' as const, gap: 2 },
    post: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 18px' },
    postMeta: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
    postId: { fontSize: 11, fontWeight: 500, color: 'var(--text-muted)' },
    postTag: { fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 4, background: 'var(--surface3)', color: 'var(--text-dim)', letterSpacing: '0.05em', textTransform: 'uppercase' as const },
    postBody: { fontSize: 14, lineHeight: 1.7, color: 'var(--text)', marginBottom: 14 },
    postActions: { display: 'flex', gap: 6, alignItems: 'center' },
    react: (on: boolean) => ({ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 6, border: on ? '1px solid rgba(91,106,240,0.3)' : '1px solid var(--border)', background: on ? 'var(--accent-dim)' : 'none', color: on ? 'var(--accent)' : 'var(--text-muted)', fontSize: 12, fontWeight: 500, cursor: 'pointer' }),
    replyToggle: { marginLeft: 'auto', padding: '5px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'none', color: 'var(--text-muted)', fontSize: 12, fontWeight: 500, cursor: 'pointer' },
    repliesWrap: { marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column' as const, gap: 8 },
    replyItem: { background: 'var(--surface2)', borderRadius: 6, padding: '10px 14px' },
    replyWho: { fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 4, letterSpacing: '0.06em', textTransform: 'uppercase' as const },
    replyText: { fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.6 },
    replyRow: { display: 'flex', gap: 6 },
    replyInput: { flex: 1, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 12px', color: 'var(--text)', fontSize: 13, outline: 'none' },
    sidebar: { display: 'flex', flexDirection: 'column' as const, gap: 20 },
    scardTitle: { fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase' as const, color: 'var(--text-muted)', marginBottom: 10 },
    aboutP: { fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.65, marginBottom: 5 },
    divider: { height: 1, background: 'var(--border)', margin: '3px 0 14px' },
    statR: { display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)' },
    statL: { fontSize: 12, color: 'var(--text-muted)' },
    statV: { fontSize: 14, fontWeight: 700, color: 'var(--text)' },
    groupR: (on: boolean) => ({ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 8px', borderRadius: 6, cursor: 'pointer', background: on ? 'var(--surface2)' : 'none' }),
    groupN: (on: boolean) => ({ fontSize: 13, color: on ? 'var(--text)' : 'var(--text-dim)', fontWeight: on ? 500 : 400 }),
    groupC: { fontSize: 11, color: 'var(--text-muted)' },
    overlay: { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 99, padding: 20 },
    modal: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 32, maxWidth: 360, width: '100%' },
  }

  if (!hasCheckedUsername) {
    return null
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <div style={c.topbar}>
        <div style={c.logo}>off record<span style={c.dot}>.</span></div>
        <div style={c.searchWrap}>
          <span style={c.searchIcon}>🔍</span>
          <input style={c.searchInput} placeholder="search..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div style={c.navBtns}>
          {user
            ? <button style={c.btnGhost} onClick={() => supabase.auth.signOut()}>sign out</button>
            : <><button style={c.btnGhost} onClick={() => setShowModal(true)}>sign in</button>
               <button style={c.btnPrimary} onClick={() => setShowModal(true)}>join</button></>
          }
        </div>
      </div>

      <div style={c.main}>
        <div>
          <h1 style={c.h1}>say the thing.</h1>

          <div style={c.composer}>
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
              <button style={c.ctab(composerMode === 'free')} onClick={() => setComposerMode('free')}>post something</button>
              <button style={c.ctab(composerMode === 'question')} onClick={() => setComposerMode('question')}>today&apos;s question</button>
            </div>
            <div style={c.composerBody}>
              {composerMode === 'free' ? (
                <>
                  <textarea style={c.textarea} placeholder="say it." value={freeText} onChange={e => setFreeText(e.target.value)} />
                  <div style={c.postRow}>
                    <select style={c.select} value={freeTopic} onChange={e => setFreeTopic(e.target.value)}>
                      {TOPICS.filter(t => t.key !== 'all').map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                    </select>
                    <button style={c.btnPrimary} onClick={submitPost}>{posting ? '...' : 'post'}</button>
                  </div>
                </>
              ) : (
                <>
                  {question && <><div style={c.qLabel}>today&apos;s question</div><div style={c.qText}>&ldquo;{question.question}&rdquo;</div></>}
                  <textarea style={c.textarea} placeholder="say it." value={questionText} onChange={e => setQuestionText(e.target.value)} />
                  <div style={c.postRow}>
                    <button style={c.btnPrimary} onClick={submitPost}>{posting ? '...' : 'post'}</button>
                  </div>
                </>
              )}
            </div>
          </div>

          <div style={c.feedHead}>
            <div style={c.feedLabel}>{totalToday} today</div>
            <div style={{ display: 'flex', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
              <button style={c.tab(sort === 'top')} onClick={() => setSort('top')}>top</button>
              <button style={c.tab(sort === 'recent')} onClick={() => setSort('recent')}>recent</button>
            </div>
          </div>

          <div style={c.feed}>
            {posts.length === 0 && <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontSize: 14 }}>no posts yet. be the first.</div>}
            {posts.map((post: any) => (
              <div key={post.id} style={c.post}>
                <div style={c.postMeta}>
                  <span style={c.postId}>{post.profiles?.display_name || post.profiles?.username} · {timeAgo(post.created_at)}</span>
                  <span style={c.postTag}>{post.topic}</span>
                </div>
                <div style={c.postBody}>{post.content}</div>
                <div style={c.postActions}>
                  <button style={c.react((post as any).user_reaction === 'same')} onClick={() => toggleReaction(post.id, 'same')}>
                    <span>same</span><span style={{ fontWeight: 600 }}>{post.same_count}</span>
                  </button>
                  <button style={c.react((post as any).user_reaction === 'damn')} onClick={() => toggleReaction(post.id, 'damn')}>
                    <span>damn</span><span style={{ fontWeight: 600 }}>{post.damn_count}</span>
                  </button>
                  <button style={c.replyToggle} onClick={() => toggleReplies(post.id)}>reply · {post.reply_count}</button>
                </div>
                {expandedReplies.has(post.id) && (
                  <div style={c.repliesWrap}>
                    {(replies[post.id] || []).map(r => (
                      <div key={r.id} style={c.replyItem}>
                        <div style={c.replyWho}>{r.profiles?.display_name || r.profiles?.username}</div>
                        <div style={c.replyText}>{r.content}</div>
                      </div>
                    ))}
                    <div style={c.replyRow}>
                      <input style={c.replyInput} placeholder="reply..." value={replyInputs[post.id] || ''} onChange={e => setReplyInputs(p => ({ ...p, [post.id]: e.target.value }))} onKeyDown={e => e.key === 'Enter' && submitReply(post.id)} />
                      <button style={c.btnPrimary} onClick={() => submitReply(post.id)}>send</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div style={c.sidebar}>
          <div>
            <div style={c.scardTitle}>about</div>
            <div style={c.divider} />
            <p style={c.aboutP}>A space for men to say the things they never say out loud.</p>
            <p style={{ ...c.aboutP, color: 'var(--text-muted)', fontSize: 12 }}>Everyone's welcome to sit with it.</p>
            <button style={{ ...c.btnPrimary, width: '100%', marginTop: 10, padding: 9 }} onClick={() => setShowModal(true)}>join</button>
          </div>
          <div>
            <div style={c.scardTitle}>today</div>
            <div style={c.divider} />
            <div style={c.statR}><span style={c.statL}>posts</span><span style={c.statV}>{totalToday}</span></div>
          </div>
          <div>
            <div style={c.scardTitle}>topics</div>
            <div style={c.divider} />
            {TOPICS.map(t => (
              <div key={t.key} style={c.groupR(topic === t.key)} onClick={() => setTopic(t.key)}>
                <span style={c.groupN(topic === t.key)}>{t.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {showModal && (
        <div style={c.overlay} onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div style={c.modal}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 10 }}>welcome</div>
            <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 6, color: 'var(--text)' }}>why are you here?</div>
            <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 20, lineHeight: 1.6 }}>no judgment. stays private.</div>
            <button style={{ ...c.btnPrimary, width: '100%', padding: 12, fontSize: 14, borderRadius: 8, marginBottom: 12 }} onClick={signInWithGoogle}>
              continue with Google
            </button>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>no real name shown · ever</div>
          </div>
        </div>
      )}

      {showUsernameModal && (
        <div style={c.overlay}>
          <div style={c.modal}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 10 }}>choose a username</div>
            <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 6, color: 'var(--text)' }}>what should we call you?</div>
            <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 20, lineHeight: 1.6 }}>
              letters and numbers only. no spaces or underscores.<br />
              like `alex92` or `chicagodad`
            </div>
            <input
              style={{ ...c.textarea, minHeight: 44, marginBottom: 12 }}
              placeholder="username"
              value={tempUsername}
              onChange={e => setTempUsername(e.target.value.toLowerCase())}
              onKeyDown={e => e.key === 'Enter' && saveUsername()}
            />
            {usernameError && <div style={{ color: '#ff6b6b', fontSize: 12, marginBottom: 12 }}>{usernameError}</div>}
            <button style={{ ...c.btnPrimary, width: '100%', padding: 12 }} onClick={saveUsername}>
              continue
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
