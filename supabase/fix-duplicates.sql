-- ============================================================
--  Rattana Chat Hub — ล้างข้อความซ้ำ + กันไม่ให้เกิดอีก
--  รันใน Supabase Dashboard > SQL Editor
--
--  ทำไมยังซ้ำทั้งที่มี unique index แล้ว:
--  index เดิมคุม (conversation_id, platform_msg_id) เฉพาะแถวที่ "มีรหัส"
--  แต่ข้อความที่เราตอบจาก Chat Hub ถูกบันทึกโดย "ยังไม่มีรหัส" (null)
--  พอ LINE/Facebook ส่งข้อความเดียวกันกลับมาพร้อมรหัสจริง → กลายเป็นอีกแถวหนึ่ง
--  index จับไม่ได้เพราะฝั่ง null ไม่ถือว่าชนกัน = ข้อความเบิ้ล
-- ============================================================

-- ── 1) ดูก่อนว่าจะลบอะไรบ้าง (ยังไม่ลบ) ────────────────────
select a.id            as ลบแถวนี้,
       b.id            as เก็บแถวนี้,
       a.direction,
       left(a.content, 60) as ข้อความ,
       a.sent_at       as เวลาแถวที่ลบ,
       b.sent_at       as เวลาแถวที่เก็บ
from public.messages a
join public.messages b
  on  a.conversation_id = b.conversation_id
  and a.direction       = b.direction
  and a.content         = b.content
  and a.id             <> b.id
  and abs(extract(epoch from (a.sent_at - b.sent_at))) < 600
where a.platform_msg_id is null
  and b.platform_msg_id is not null
order by a.sent_at desc;


-- ── 2) ลบจริง — เก็บแถวที่มีรหัสแพลตฟอร์มไว้ ────────────────
-- (แถวที่มีรหัสดีกว่า เพราะมันจะกันซ้ำรอบต่อไปได้)
delete from public.messages a
using public.messages b
where a.platform_msg_id is null
  and b.platform_msg_id is not null
  and a.id             <> b.id
  and a.conversation_id = b.conversation_id
  and a.direction       = b.direction
  and a.content         = b.content
  and abs(extract(epoch from (a.sent_at - b.sent_at))) < 600;


-- ── 3) เก็บกวาดซ้ำที่เหลือ (เนื้อหา+ทิศทาง+เวลาเดียวกันเป๊ะ) ──
-- เก็บแถวที่เก่าที่สุดไว้อันเดียว
delete from public.messages m
using (
  select id,
         row_number() over (
           partition by conversation_id, direction, content, sent_at
           order by created_at nulls last, id
         ) as rn
  from public.messages
) d
where m.id = d.id and d.rn > 1;


-- ── 4) ตรวจผล — ต้องได้ 0 ทั้งคู่ ──────────────────────────
select
  (select count(*) from (
     select conversation_id, platform_msg_id
     from public.messages where platform_msg_id is not null
     group by 1,2 having count(*) > 1) x)               as ซ้ำโดยรหัสข้อความ,
  (select count(*) from (
     select conversation_id, direction, content, sent_at
     from public.messages group by 1,2,3,4 having count(*) > 1) y) as ซ้ำโดยเนื้อหาและเวลา,
  (select count(*) from public.messages)                as ข้อความทั้งหมด;
