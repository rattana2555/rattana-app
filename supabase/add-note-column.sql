-- เก็บเหตุผลที่ส่งข้อความไม่สำเร็จไว้กับตัวข้อความ
-- พนักงานจะเห็นสาเหตุจริงในแอพเลย ไม่ต้องเปิด Console หรือ log ของ Supabase
alter table public.messages add column if not exists note text;
