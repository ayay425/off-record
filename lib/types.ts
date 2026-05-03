export interface Profile {
  id: string
  username: string
  created_at: string
}

export interface Post {
  id: string
  user_id: string
  content: string
  topic: string
  is_question_response: boolean
  same_count: number
  damn_count: number
  reply_count: number
  created_at: string
  profiles?: Profile
  user_reaction?: 'same' | 'damn' | null
}

export interface Reply {
  id: string
  post_id: string
  user_id: string
  content: string
  created_at: string
  profiles?: Profile
}

export interface DailyQuestion {
  id: string
  question: string
  date: string
}

export type Topic = 'all' | 'relationships' | 'loneliness' | 'work' | 'family' | 'identity' | 'loss'
