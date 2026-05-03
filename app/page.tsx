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
  const [showNameModal, setShowNameModal] = useState(false)
  const [showRenameModal, setShowRenameModal] = useState(false)
  const [tempDisplayName, setTempDisplayName] = useState('')
  const [nameError, setNameError] = useState('')
  const [posting, setPosting] = useState(false)
  const [totalToday, setTotalToday] = useState(0)
  const [hasDisplayName, setHasDisplayName] = useState(false)
  const [renameCount, setRenameCount] = useState(0)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user)
      if (data.user) checkProfile(data.user.id)
    })
    supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null)
      if (session?.user) checkProfile(session.user.id)
    })
    loadQuestion()
  }, [])

  useEffect(() => { loadPosts() }, [topic, sort, search])

  async function checkProfile(userId: string) {
    const { data } = await supabase
      .from('profiles')
      .select('display_name, rename_count')
      .eq('id', userId)
      .single()
    if (data) {
      setHasDisplayName(!!data.display_name)
      setRenameCount(data.rename_count || 0)
      if (!data.display_name) setShowNameModal(true)
    }
  }

  async function loadQuestion() {
    const today = new Date().toISOString().split('T')[0]
    const { data } = await supabase.from('daily_questions').select('*').eq('date', today).single()
    if (data) setQuestion(data)
  }

  async function loadPosts() {
    let query = supabase.from('posts').select('*, profiles(display_name, username)')
    if (topic !== 'all') query = query.eq('topic', topic)
    if (search) query = query.ilike('content', `%${search}%`)
    query = sort === 'top'
      ? query.order('same_count', { ascending: false })
      : query.order('created_at', { ascending: false })
    const { data } = await query
   
