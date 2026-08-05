-- ============================================================
--  Rattana Unified Inbox — Supabase Schema
--  วิธีใช้: เปิด Supabase Dashboard > SQL Editor > วาง > Run
-- ============================================================

-- UUID extension (มักเปิดอยู่แล้ว)
create extension if not exists "uuid-ossp";

-- ── CONVERSATIONS ──────────────────────────────────────────
create table if not exists public.conversations (
  id               uuid default gen_random_uuid() primary key,
  platform         text not null,            -- line | facebook | tiktok | shopee | tiktokshop
  platform_conv_id text not null,            -- user_id หรือ thread_id จากแพลตฟอร์ม
  customer_name    text default 'ลูกค้า',
  customer_id      text,
  last_message     text default '',
  last_message_at  timestamptz default now(),
  unread_count     int  default 0,
  metadata         jsonb default '{}',
  created_at       timestamptz default now(),
  unique (platform, platform_conv_id)
);

-- ── MESSAGES ───────────────────────────────────────────────
create table if not exists public.messages (
  id              uuid default gen_random_uuid() primary key,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  direction       text not null check (direction in ('in','out')),  -- in=ลูกค้า, out=ทีม
  content         text not null default '',
  message_type    text default 'text',
  platform_msg_id text,
  sent_at         timestamptz default now(),
  created_at      timestamptz default now()
);

-- ── INDEXES ────────────────────────────────────────────────
-- สถานะการส่งของข้อความขาออก: sending → sent | failed
-- ข้อความถูกบันทึกก่อนเสมอ สถานะค่อยอัพเดตตามผลการส่งเข้าแพลตฟอร์ม
alter table public.messages add column if not exists status text default 'sent';

create index if not exists idx_msgs_conv    on public.messages      (conversation_id, sent_at);
create index if not exists idx_convs_plat   on public.conversations  (platform, last_message_at desc);

-- ── HELPER FUNCTIONS ───────────────────────────────────────
create or replace function public.increment_unread(conv_id uuid)
returns void language sql security definer as $$
  update public.conversations set unread_count = unread_count + 1 where id = conv_id;
$$;

create or replace function public.reset_unread(conv_id uuid)
returns void language sql security definer as $$
  update public.conversations set unread_count = 0 where id = conv_id;
$$;

-- ── REALTIME ───────────────────────────────────────────────
-- เพิ่มเฉพาะถ้ายังไม่มี — รันซ้ำได้ไม่ error
do $$
begin
  if not exists (select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='conversations') then
    alter publication supabase_realtime add table public.conversations;
  end if;
  if not exists (select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;

-- ── ทะเบียนพนักงานฝั่งเซิร์ฟเวอร์ ──────────────────────────
-- ⚠️ บทเรียนสำคัญ: "authenticated" ≠ "พนักงาน"
-- Supabase เปิดให้สมัครได้ ใครมีบัญชี Google ก็เป็น authenticated ได้ทันที
-- การเช็ครายชื่อในเบราว์เซอร์กันไม่ได้ เพราะ JWT ถูกออกให้ไปแล้วก่อนเช็ค
-- คนที่ได้ JWT มาสามารถ curl ตรงเข้า PostgREST ข้ามหน้าเว็บไปเลย
-- ดังนั้นรายชื่อพนักงานต้องอยู่ในฐานข้อมูล และ RLS ต้องเป็นคนตรวจ
create table if not exists public.staff (
  email      text primary key,
  nick       text,
  name       text,
  active     boolean default true,
  updated_at timestamptz default now()
);

alter table public.staff enable row level security;
drop policy if exists "self_read" on public.staff;
-- พนักงานอ่านได้เฉพาะแถวของตัวเอง (ไว้ดึงชื่อเล่นมาทักทาย) — ไม่เห็นรายชื่อคนอื่น
create policy "self_read" on public.staff
  for select to authenticated
  using (lower(email) = lower(auth.jwt() ->> 'email'));

create or replace function public.is_staff()
returns boolean language sql stable security definer
set search_path = public as $$
  select exists (
    select 1 from public.staff
    where lower(email) = lower(auth.jwt() ->> 'email') and active
  );
$$;
revoke execute on function public.is_staff() from public, anon;
grant  execute on function public.is_staff() to authenticated;

-- ── ROW LEVEL SECURITY ─────────────────────────────────────
-- แอพ deploy อยู่บน URL สาธารณะ (GitHub Pages) พร้อม anon key ฝังในไฟล์
-- RLS คือด่านกันจริงด่านเดียว — ต้องตรวจถึงระดับ "เป็นพนักงานที่ยังทำงานอยู่"
alter table public.conversations enable row level security;
alter table public.messages       enable row level security;

drop policy if exists "open_access"  on public.conversations;
drop policy if exists "open_access"  on public.messages;
drop policy if exists "team_access"  on public.conversations;
drop policy if exists "team_access"  on public.messages;
drop policy if exists "staff_access" on public.conversations;
drop policy if exists "staff_access" on public.messages;

create policy "staff_access" on public.conversations
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "staff_access" on public.messages
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- Edge Functions (webhook) ใช้ service_role → bypass RLS ได้อยู่แล้ว ไม่ต้องมี policy

-- ── FUNCTION PERMISSIONS ───────────────────────────────────
-- ทั้งสอง function เป็น security definer (bypass RLS)
-- ต้องตัดสิทธิ์ anon ไม่งั้นคนนอกเรียกได้โดยไม่ต้องล็อกอิน
revoke execute on function public.increment_unread(uuid) from public, anon;
revoke execute on function public.reset_unread(uuid)     from public, anon;
grant  execute on function public.increment_unread(uuid) to authenticated, service_role;
grant  execute on function public.reset_unread(uuid)     to authenticated, service_role;

-- ── DONE ───────────────────────────────────────────────────
-- ตาราง: conversations, messages
-- functions: increment_unread, reset_unread (authenticated + service_role เท่านั้น)
-- realtime: เปิดแล้ว
-- RLS: เฉพาะผู้ที่ล็อกอิน (Supabase Auth)
--
-- ⚠️ ต้องทำใน Dashboard ด้วย:
--   1. Authentication > Providers > Email > ปิด "Allow new users to sign up"
--      (ไม่งั้นใครก็สมัครเองแล้วเข้าถึงข้อมูลได้)
--   2. Edge Functions > webhook-line + webhook-facebook > ปิด "Verify JWT"
--      (LINE/Facebook ไม่ได้ส่ง JWT มา — ถ้าเปิดไว้ webhook จะได้ 401)
--   3. Edge Functions > send-message- > เปิด "Verify JWT" ไว้ (ถูกแล้ว)
