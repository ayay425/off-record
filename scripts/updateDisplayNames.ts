/**
 * Assigns a random display_name to profiles where display_name IS NULL.
 *
 * Requires on `public.profiles`: `display_name text`, `rename_count int` (add via migration if missing).
 * Must use the service role key: the anon key cannot bulk-update other users under RLS.
 */
import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceKey) {
  console.error(
    'Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local (use the service role secret from Supabase dashboard).'
  )
  process.exit(1)
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const namePool = [
  'alex',
  'emily',
  'chicagodad',
  'lostinlife',
  'justtrying',
  'sarah',
  'mikefromohio',
  'curiouslily',
  'dave',
  'jessica',
  'alexchen',
  'emilyw',
  'chicagoguy',
  'lonelydad',
  'rachel',
  'kevin',
  'lauren',
  'jason',
  'amanda',
  'someguy',
  'noidea',
  'whoknows',
  'whatever',
  'alexis',
  'chris',
  'matt',
  'justagirl',
  'nickname',
  'hellothere',
  'randomdude',
  'idkman',
  'whateverworks',
  'thisisme',
  'emilywonders',
  'lostdad',
  'mamaknows',
  'johnny',
  'jackie',
  'tryinghard',
  'curiouscat',
  'alrightthen',
  'differentdude',
  'lurker',
  'quietguy',
  'tiredman',
  'justhere',
  'readingonly',
  'occasional',
  'maybeoneday',
  'learning',
  'confuseddad',
  'worriedson',
  'silenttype',
  'rareposter',
  'longtime',
  'newhere',
  'finallysaying',
  'gettingthere',
  'notsure',
]

function pickDisplayName(): string {
  const base = namePool[Math.floor(Math.random() * namePool.length)]!
  const withNumber = Math.random() < 0.4
  const suffix = withNumber ? Math.floor(Math.random() * 9900 + 100).toString() : ''
  return base + suffix
}

async function updateDisplayNames() {
  const { data: users, error } = await supabase
    .from('profiles')
    .select('id')
    .is('display_name', null)

  if (error) throw error
  if (!users?.length) {
    console.log('No profiles with null display_name.')
    return
  }

  let ok = 0
  const maxAttempts = 12

  for (const user of users) {
    let updated = false

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const displayName = pickDisplayName()
      const { error: upErr } = await supabase
        .from('profiles')
        .update({ display_name: displayName, rename_count: 1 })
        .eq('id', user.id)

      if (!upErr) {
        ok++
        updated = true
        break
      }

      const msg = upErr.message ?? ''
      if (msg.includes('duplicate') || msg.includes('unique') || msg.includes('23505')) {
        continue
      }
      throw upErr
    }

    if (!updated) {
      console.error(`Failed to assign a unique display_name for profile ${user.id} after ${maxAttempts} attempts`)
    }
  }

  console.log(`Updated ${ok} of ${users.length} users`)
}

updateDisplayNames().catch((e) => {
  console.error(e)
  process.exit(1)
})
