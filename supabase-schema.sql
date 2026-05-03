-- Users profile (extends Supabase auth)
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  username text unique,
  created_at timestamp with time zone default timezone('utc'::text, now())
);

-- Posts
create table if not exists public.posts (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade,
  content text not null check (char_length(content) > 0 and char_length(content) <= 2000),
  topic text not null default 'general',
  is_question_response boolean default false,
  same_count integer default 0,
  damn_count integer default 0,
  reply_count integer default 0,
  created_at timestamp with time zone default timezone('utc'::text, now())
);

-- Replies
create table if not exists public.replies (
  id uuid default gen_random_uuid() primary key,
  post_id uuid references public.posts(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  content text not null check (char_length(content) > 0 and char_length(content) <= 1000),
  created_at timestamp with time zone default timezone('utc'::text, now())
);

-- Reactions (same / damn)
create table if not exists public.reactions (
  id uuid default gen_random_uuid() primary key,
  post_id uuid references public.posts(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  reaction_type text not null check (reaction_type in ('same', 'damn')),
  created_at timestamp with time zone default timezone('utc'::text, now()),
  unique(post_id, user_id, reaction_type)
);

-- Today's question
create table if not exists public.daily_questions (
  id uuid default gen_random_uuid() primary key,
  question text not null,
  date date not null default current_date,
  created_at timestamp with time zone default timezone('utc'::text, now())
);

-- Insert today's question
insert into public.daily_questions (question, date) values
  ('what''s something you''ve been carrying alone that nobody knows about?', current_date)
on conflict do nothing;

-- Anonymous display names
create table if not exists public.anon_names (
  id uuid default gen_random_uuid() primary key,
  name text not null unique
);

insert into public.anon_names (name) values
  ('iron tide'), ('pale smoke'), ('dark river'), ('cold static'),
  ('grey wing'), ('hard rain'), ('blue stone'), ('amber wolf'),
  ('silver dusk'), ('quiet river'), ('grey ember'), ('pale shore'),
  ('black frost'), ('still water'), ('deep current'), ('low light'),
  ('worn path'), ('old smoke'), ('stone floor'), ('late hour')
on conflict do nothing;

-- RLS policies
alter table public.profiles enable row level security;
alter table public.posts enable row level security;
alter table public.replies enable row level security;
alter table public.reactions enable row level security;
alter table public.daily_questions enable row level security;
alter table public.anon_names enable row level security;

-- Profiles
create policy "Public profiles are viewable by everyone" on public.profiles for select using (true);
create policy "Users can insert their own profile" on public.profiles for insert with check (auth.uid() = id);
create policy "Users can update their own profile" on public.profiles for update using (auth.uid() = id);

-- Posts
create policy "Posts are viewable by everyone" on public.posts for select using (true);
create policy "Authenticated users can create posts" on public.posts for insert with check (auth.uid() = user_id);
create policy "Users can delete their own posts" on public.posts for delete using (auth.uid() = user_id);

-- Replies
create policy "Replies are viewable by everyone" on public.replies for select using (true);
create policy "Authenticated users can create replies" on public.replies for insert with check (auth.uid() = user_id);

-- Reactions
create policy "Reactions are viewable by everyone" on public.reactions for select using (true);
create policy "Authenticated users can react" on public.reactions for insert with check (auth.uid() = user_id);
create policy "Users can remove their own reactions" on public.reactions for delete using (auth.uid() = user_id);

-- Daily questions
create policy "Questions are viewable by everyone" on public.daily_questions for select using (true);

-- Anon names
create policy "Anon names are viewable by everyone" on public.anon_names for select using (true);

-- Function: auto create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
declare
  random_name text;
begin
  select name into random_name from public.anon_names order by random() limit 1;
  insert into public.profiles (id, username)
  values (new.id, random_name || ' ' || floor(random() * 9000 + 1000)::text);
  return new;
end;
$$ language plpgsql security definer;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Function: update reply count
create or replace function public.update_reply_count()
returns trigger as $$
begin
  if TG_OP = 'INSERT' then
    update public.posts set reply_count = reply_count + 1 where id = new.post_id;
  end if;
  return new;
end;
$$ language plpgsql security definer;

create or replace trigger on_reply_created
  after insert on public.replies
  for each row execute procedure public.update_reply_count();
