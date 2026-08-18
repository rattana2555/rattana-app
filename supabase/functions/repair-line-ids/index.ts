// ============================================================
//  Rattana Chat Hub — Repair LINE IDs (ซ่อมรหัสแชท LINE ที่ส่งไม่ได้)
//  Deploy: Supabase Dashboard > Edge Functions > New Function
//  Name: repair-line-ids
//
//  ปัญหาที่แก้:
//  แชทที่ส่วนขยายอ่านมาจาก LINE OA Manager ติดรหัส chatId ซึ่งเอาไปส่งข้อความไม่ได้
//  (Messaging API ใช้ userId คนละชุด) พนักงานจึงตอบจาก Chat Hub ไม่ได้
//
//  วิธีซ่อม:
//  ขอรายชื่อผู้ติดตามทั้งหมดจาก LINE → ดูชื่อทีละคน → ชื่อไหนตรงกับแชทที่เสีย
//  ก็เอา userId จริงไปใส่ให้ จากนั้นตอบจาก Chat Hub ได้เลย
//
//  ⚠️ ใช้ครั้งเดียวแล้วลบทิ้งได้ ไม่ใช่ส่วนที่ทำงานประจำ
//  ⚠️ รายชื่อผู้ติดตามใช้ได้เฉพาะบัญชีรับรอง (badge ฟ้า) หรือพรีเมียม
// ============================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const LINE_TOKEN   = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization,content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b, null, 2), {
    status: s, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const line = (path: string) =>
  fetch(`https://api.line.me${path}`, { headers: { Authorization: `Bearer ${LINE_TOKEN}` } });

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!LINE_TOKEN) return json({ ok: false, error: "ยังไม่ได้ตั้ง LINE_CHANNEL_ACCESS_TOKEN" }, 500);

  const url    = new URL(req.url);
  const start  = url.searchParams.get("start") ?? "";     // ทำต่อจากรอบก่อน
  const dryRun = url.searchParams.get("dry") === "1";      // ดูเฉยๆ ไม่แก้จริง
  const BUDGET = 80_000;                                   // กันฟังก์ชันหมดเวลากลางคัน
  const t0 = Date.now();

  const db = createClient(SUPABASE_URL, SERVICE_KEY);

  // ── แชทที่ต้องซ่อม = LINE ที่ยังไม่มี customer_id ──────────
  const { data: targets, error: tErr } = await db
    .from("conversations")
    .select("id, customer_name")
    .eq("platform", "line")
    .is("customer_id", null);
  if (tErr) return json({ ok: false, error: tErr.message }, 500);

  const want = new Map<string, string>();   // ชื่อลูกค้า → id แถวใน DB
  for (const t of targets ?? []) {
    const n = (t.customer_name ?? "").trim();
    if (n && n !== "ลูกค้า") want.set(n, t.id);
  }
  if (!want.size) return json({ ok: true, message: "ไม่มีแชทที่ต้องซ่อม", fixed: 0 });

  // รหัสที่ถูกใช้ไปแล้ว — กันชนกับ unique (platform, platform_conv_id)
  const { data: used } = await db
    .from("conversations").select("platform_conv_id").eq("platform", "line");
  const taken = new Set((used ?? []).map((r: any) => r.platform_conv_id));

  let cursor = start, scanned = 0, fixed = 0, skipped = 0;
  const report: string[] = [];
  const total = want.size;

  while (want.size) {
    const res = await line(`/v2/bot/followers/ids?limit=1000${cursor ? `&start=${cursor}` : ""}`);
    if (!res.ok) {
      const body = await res.text();
      return json({
        ok: false, status: res.status, fixed,
        error: res.status === 403
          ? "บัญชี LINE นี้ยังขอรายชื่อผู้ติดตามไม่ได้ — ต้องเป็นบัญชีรับรอง (badge ฟ้า) หรือพรีเมียม"
          : body,
      }, 200);
    }
    const page = await res.json();
    const ids: string[] = page.userIds ?? [];
    cursor = page.next ?? "";

    // ถามชื่อทีละ 20 คนพร้อมกัน — เร็วพอโดยไม่ยิงถี่จนโดนจำกัด
    for (let i = 0; i < ids.length && want.size; i += 20) {
      const profs = await Promise.all(ids.slice(i, i + 20).map(async (uid) => {
        try {
          const r = await line(`/v2/bot/profile/${uid}`);
          if (!r.ok) return null;
          const p = await r.json();
          return { uid, name: String(p.displayName ?? "").trim(), avatar: p.pictureUrl ?? null };
        } catch { return null; }
      }));
      scanned += Math.min(20, ids.length - i);

      for (const p of profs) {
        if (!p || !p.name) continue;
        const rowId = want.get(p.name);
        if (!rowId) continue;
        want.delete(p.name);

        if (taken.has(p.uid)) {                       // มีแชทอื่นใช้รหัสนี้อยู่แล้ว
          skipped++; report.push(`ข้าม "${p.name}" — มีแชทที่ใช้รหัสนี้อยู่แล้ว`);
          continue;
        }
        if (dryRun) { fixed++; report.push(`(ทดลอง) จะซ่อม "${p.name}"`); taken.add(p.uid); continue; }

        const { error } = await db.from("conversations").update({
          platform_conv_id: p.uid,
          customer_id: p.uid,
          ...(p.avatar ? { avatar_url: p.avatar } : {}),
        }).eq("id", rowId);

        if (error) { report.push(`ซ่อม "${p.name}" ไม่สำเร็จ: ${error.message}`); continue; }
        taken.add(p.uid); fixed++; report.push(`ซ่อมแล้ว: ${p.name}`);
      }
      if (Date.now() - t0 > BUDGET) break;
    }
    if (!cursor || Date.now() - t0 > BUDGET) break;
  }

  return json({
    ok: true,
    ต้องซ่อมทั้งหมด: total,
    ซ่อมสำเร็จ: fixed,
    ข้าม: skipped,
    ไล่ดูผู้ติดตามไปแล้ว: scanned,
    ยังไม่เจอ: [...want.keys()],
    ทำต่อด้วย: cursor ? `?start=${cursor}` : null,
    report,
  });
});
