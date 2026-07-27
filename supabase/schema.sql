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
alter publication supabase_realtime add table public.conversations;
alter publication supabase_realtime add table public.messages;

-- ── ROW LEVEL SECURITY ─────────────────────────────────────
alter table public.conversations enable row level security;
alter table public.messages       enable row level security;

-- เปิด all access ก่อน (ล็อกทีหลังเมื่อเพิ่ม auth)
drop policy if exists "open_access" on public.conversations;
drop policy if exists "open_access" on public.messages;
create policy "open_access" on public.conversations for all using (true) with check (true);
create policy "open_access" on public.messages       for all using (true) with check (true);

-- ── DONE ───────────────────────────────────────────────────
-- ตาราง: conversations, messages
-- functions: increment_unread, reset_unread
-- realtime: เปิดแล้ว
