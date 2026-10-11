-- Warmezy: daily leaderboard tables + RPCs.
-- Lives in the same Supabase project as the other bgameworld games, so one
-- account works across all of them. Same design as Sortezy: tables are
-- public-readable where needed and never directly writable — every write goes
-- through a SECURITY DEFINER function that takes the player's identity from
-- auth.uid(), not from anything the client sends.
--
-- One result per player per day: the first finish counts (solved or gave up),
-- since a second go at a known word would always do better.

create table if not exists public.warmezy_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default 'Player' check (char_length(display_name) between 1 and 20),
  created_at timestamptz not null default now()
);

create table if not exists public.warmezy_scores (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 20),
  puzzle_date date not null,
  -- Guesses including hint words.
  guesses integer not null check (guesses between 1 and 5000),
  hints integer not null default 0 check (hints between 0 and 5000),
  solved boolean not null,
  created_at timestamptz not null default now(),
  constraint warmezy_scores_player_date_key unique (player_id, puzzle_date),
  constraint warmezy_scores_hints_le_guesses check (hints <= guesses)
);

create index if not exists warmezy_scores_date_rank_idx
  on public.warmezy_scores (puzzle_date, solved, guesses, hints);

alter table public.warmezy_profiles enable row level security;
alter table public.warmezy_scores enable row level security;

drop policy if exists warmezy_profiles_select_own on public.warmezy_profiles;
create policy warmezy_profiles_select_own on public.warmezy_profiles
  for select using (id = (select auth.uid()));

drop policy if exists warmezy_scores_public_read on public.warmezy_scores;
create policy warmezy_scores_public_read on public.warmezy_scores
  for select using (true);

-- Sets (or changes) the caller's display name.
create or replace function public.warmezy_update_profile(p_display_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if char_length(coalesce(trim(p_display_name), '')) < 1 or char_length(trim(p_display_name)) > 20 then
    raise exception 'invalid display_name';
  end if;

  insert into public.warmezy_profiles (id, display_name)
  values (auth.uid(), trim(p_display_name))
  on conflict (id) do update set display_name = excluded.display_name;
end;
$$;

-- Returns the caller's display name for this game. A signed-in (non-guest)
-- player with a name in another bgameworld game gets it copied over the first
-- time. The other games' profile tables are looked up only if they exist, so
-- this works whichever of their migrations have been run.
create or replace function public.warmezy_ensure_profile()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
  v_is_anon boolean := coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
  v_table text;
begin
  if v_uid is null then
    return null;
  end if;

  select display_name into v_name from public.warmezy_profiles where id = v_uid;
  if v_name is not null or v_is_anon then
    return v_name;
  end if;

  foreach v_table in array array['letterezy_profiles', 'mergezy_profiles', 'sortezy_profiles', 'wordezy_ladder_profiles', 'wordezy_scramble_profiles', 'wordezy_search_profiles', 'profiles'] loop
    exit when v_name is not null;
    if to_regclass('public.' || v_table) is not null then
      execute format('select display_name from public.%I where id = $1', v_table) into v_name using v_uid;
    end if;
  end loop;

  v_name := left(trim(coalesce(v_name, '')), 20);
  if v_name = '' then
    v_name := 'Player';
  end if;

  insert into public.warmezy_profiles (id, display_name)
  values (v_uid, v_name)
  on conflict (id) do nothing;
  return v_name;
end;
$$;

-- Records the caller's finished daily (solved or gave up). The FIRST finish
-- of the day is the one that counts.
create or replace function public.submit_warmezy_score(p_puzzle_date date, p_guesses integer, p_hints integer, p_solved boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_banned boolean;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_guesses is null or p_guesses < 1 or p_guesses > 5000 then
    raise exception 'invalid guesses';
  end if;
  if p_hints is null or p_hints < 0 or p_hints > p_guesses then
    raise exception 'invalid hints';
  end if;
  if p_solved is null then
    raise exception 'invalid solved';
  end if;
  -- Daily puzzles roll over at midnight UTC; allow one day either side for
  -- players finishing across the boundary, but never a far past/future date.
  if p_puzzle_date is null or abs(p_puzzle_date - (now() at time zone 'utc')::date) > 1 then
    raise exception 'invalid puzzle_date';
  end if;
  -- Accounts banned in the shared profiles table (When & Where / Wordezy).
  -- Looked up dynamically so this works in a project without that table.
  if to_regclass('public.profiles') is not null then
    execute 'select exists (select 1 from public.profiles where id = $1 and is_banned)' into v_banned using auth.uid();
    if v_banned then
      raise exception 'account suspended';
    end if;
  end if;

  select display_name into v_name from public.warmezy_profiles where id = auth.uid();
  if v_name is null then
    raise exception 'profile not set up';
  end if;

  insert into public.warmezy_scores (player_id, display_name, puzzle_date, guesses, hints, solved)
  values (auth.uid(), v_name, p_puzzle_date, p_guesses, p_hints, p_solved)
  on conflict (player_id, puzzle_date) do nothing;
end;
$$;

-- Today's solvers: fewest guesses, then fewest hints, then earliest.
create or replace function public.warmezy_daily_leaderboard(p_puzzle_date date, p_limit integer default 10)
returns table (player_id uuid, display_name text, guesses integer, hints integer)
language sql
stable
set search_path = public
as $$
  select s.player_id, s.display_name, s.guesses, s.hints
  from public.warmezy_scores s
  where s.puzzle_date = p_puzzle_date and s.solved
  order by s.guesses asc, s.hints asc, s.created_at asc
  limit greatest(1, least(p_limit, 100))
$$;

-- "312 players today · 240 found it · avg 38 guesses" (average over solvers).
create or replace function public.warmezy_daily_stats(p_puzzle_date date)
returns table (players bigint, solved bigint, average_guesses numeric)
language sql
stable
set search_path = public
as $$
  select count(*), count(*) filter (where s.solved), coalesce(round(avg(s.guesses) filter (where s.solved)), 0)
  from public.warmezy_scores s
  where s.puzzle_date = p_puzzle_date
$$;

-- All-time standings: most solves, then the lowest average guesses per solve.
create or replace function public.warmezy_alltime_leaderboard(p_limit integer default 10)
returns table (player_id uuid, display_name text, solves bigint, average_guesses numeric)
language sql
stable
set search_path = public
as $$
  select
    s.player_id,
    (array_agg(s.display_name order by s.created_at desc))[1] as display_name,
    count(*) filter (where s.solved) as solves,
    round(avg(s.guesses) filter (where s.solved)) as average_guesses
  from public.warmezy_scores s
  group by s.player_id
  having count(*) filter (where s.solved) > 0
  order by solves desc, average_guesses asc
  limit greatest(1, least(p_limit, 100))
$$;

-- Functions are executable by PUBLIC by default in Postgres; lock the
-- writers down to signed-in sessions (guests are signed in anonymously and
-- carry the "authenticated" role too) and leave the readers open.
revoke all on function public.warmezy_update_profile(text) from public, anon;
revoke all on function public.warmezy_ensure_profile() from public, anon;
revoke all on function public.submit_warmezy_score(date, integer, integer, boolean) from public, anon;
grant execute on function public.warmezy_update_profile(text) to authenticated;
grant execute on function public.warmezy_ensure_profile() to authenticated;
grant execute on function public.submit_warmezy_score(date, integer, integer, boolean) to authenticated;
grant execute on function public.warmezy_daily_leaderboard(date, integer) to anon, authenticated;
grant execute on function public.warmezy_daily_stats(date) to anon, authenticated;
grant execute on function public.warmezy_alltime_leaderboard(integer) to anon, authenticated;
