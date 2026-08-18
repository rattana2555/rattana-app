// ============================================================
//  Rattana Chat Hub — Ingest Shopee (รับแชทจากส่วนขยายเบราว์เซอร์)
//  Deploy: Supabase Dashboard > Edge Functions > New Function
//  Name: ingest-shopee
//
//  ทำไมต้องมีตัวนี้:
//  Shopee ไม่เปิด API แชทให้ร้านทั่วไป (ต้องเป็น Mall/Managed Seller)
//  จึงใช้ส่วนขยาย Chrome อ่านจากหน้า Seller Center ที่พนักงานเปิดอยู่แล้วส่งมาที่นี่
//  ตัวนี้ทำหน้าที่รับ → ตรวจรหัสลับ → บันทึกลงตารางเดียวกับ LINE/Facebook
//
//  ⚠️ ตั้งใจให้ "อ่านอย่างเดียว" — การตอบลูกค้ายังทำใน Shopee ตามปกติ
// ============================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const INGEST_SECRET = Deno.env.get("SHOPEE_INGEST_SECRET") ?? "";
const SUPABASE_URL  = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type,x-ingest-secret",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

type InMsg = {
  id: string;            // รหัสข้อความจาก Shopee (กันบันทึกซ้ำ)
  from: "buyer" | "seller";
  text?: string;
  imageUrl?: string;
  sentAt: string | number;  // ISO string หรือ epoch
};

type InConv = {
  convId: string;        // รหัสบทสนทนาจากแพลตฟอร์ม
  name?: string;
  avatar?: string;
  messages: InMsg[];
  // TikTok: อ่านจากรายการแชทฝั่งซ้ายได้แค่บรรทัดล่าสุด (ยังไม่มีใครคลิกเปิด)
  preview?: string;
  previewAt?: number;
};

// รับได้ทั้ง shopee และ line (ส่วนขยายอ่านจากหน้าเว็บที่พนักงานเปิดอยู่)
// กรณี line: ถ้า convId ตรงกับ userId ที่ webhook เคยสร้างไว้ จะรวมเป็นบทสนทนาเดียวกันเอง
const ALLOWED = new Set(["shopee", "line", "tiktok", "tiktokshop"]);

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST")    return json({ error: "Method Not Allowed" }, 405);

  // fail closed — ไม่ตั้ง secret = ไม่รับอะไรเลย
  if (!INGEST_SECRET) {
    console.error("SHOPEE_INGEST_SECRET ยังไม่ได้ตั้ง — ปฏิเสธทั้งหมด");
    return json({ error: "not configured" }, 503);
  }
  if (req.headers.get("x-ingest-secret") !== INGEST_SECRET) {
    return json({ error: "unauthorized" }, 401);
  }

  let payload: { conversations?: InConv[]; platform?: string };
  try { payload = await req.json(); }
  catch { return json({ error: "invalid json" }, 400); }

  const platform = String(payload.platform ?? "shopee");
  if (!ALLOWED.has(platform)) return json({ error: "unknown platform" }, 400);

  const convs = payload.conversations ?? [];
  if (!Array.isArray(convs) || !convs.length) return json({ ok: true, conversations: 0, newMessages: 0 });

  const db = createClient(SUPABASE_URL, SERVICE_KEY);
  let convCount = 0, msgCount = 0;

  for (const c of convs.slice(0, 100)) {
    if (!c?.convId) continue;
    // TikTok ส่งแชทจาก "รายการฝั่งซ้าย" มาด้วย ซึ่งมีแค่ข้อความล่าสุด ไม่มีเนื้อหาเต็ม
    // (ยังไม่มีใครคลิกเปิด) — อัพเดตแค่บรรทัดล่าสุดให้เห็นว่ามีความเคลื่อนไหว
    const inMsgs = Array.isArray(c.messages) ? c.messages : [];
    if (!inMsgs.length && !c.preview) continue;

    const norm = inMsgs
      .filter((m) => m && m.id && (m.text || m.imageUrl))
      .map((m) => ({
        id: String(m.id),
        direction: m.from === "seller" ? "out" : "in",
        content: m.imageUrl ? String(m.imageUrl) : String(m.text ?? ""),
        message_type: m.imageUrl ? "image" : "text",
        sent_at: new Date(typeof m.sentAt === "number" ? m.sentAt : Date.parse(m.sentAt)).toISOString(),
      }))
      .sort((a, b) => a.sent_at.localeCompare(b.sent_at));

    if (!norm.length && !c.preview) continue;
    const last = norm.length
      ? norm[norm.length - 1]
      : { message_type: "text", content: String(c.preview),
          sent_at: new Date(Number(c.previewAt) || Date.now()).toISOString() };

    // ── หาบทสนทนาเดิม ─────────────────────────────────────
    // LINE ใช้ id คนละชุดระหว่าง Messaging API (webhook) กับ OA Manager (ส่วนขยาย)
    // ถ้าจับคู่ด้วย id อย่างเดียวจะได้แชทซ้ำคนละ 2 แถว จึงต้องจับคู่ด้วย "ชื่อ" เสริม
    let { data: prev } = await db
      .from("conversations")
      .select("id, platform_conv_id, customer_name, avatar_url, last_message_at")
      .eq("platform", platform)
      .eq("platform_conv_id", String(c.convId))
      .maybeSingle();

    if (!prev && platform === "line" && c.name) {
      const { data: byName } = await db
        .from("conversations")
        .select("id, platform_conv_id, customer_name, avatar_url")
        .eq("platform", "line")
        .eq("customer_name", c.name)
        .limit(1)
        .maybeSingle();
      if (byName) prev = byName;   // เจอคนเดียวกันที่ webhook สร้างไว้ → ใช้แถวนั้น
    }

    const row: Record<string, unknown> = {};
    // อย่าให้ "ข้อความล่าสุด" ถอยหลัง — รายการฝั่งซ้ายบอกเวลาแค่ระดับวัน อาจเก่ากว่าของจริง
    if (!prev?.last_message_at || last.sent_at >= prev.last_message_at) {
      row.last_message = last.message_type === "image" ? "[รูปภาพ]" : last.content;
      row.last_message_at = last.sent_at;
    }
    const hasName = prev?.customer_name && prev.customer_name !== "ลูกค้า";
    if (c.name && !hasName) row.customer_name = c.name;
    if (c.avatar && !prev?.avatar_url) row.avatar_url = c.avatar;

    let conv: { id: string } | null = null;

    if (prev && !Object.keys(row).length) { conv = { id: prev.id }; }
    else if (prev) {
      // มีอยู่แล้ว — อัพเดตแถวเดิม ห้ามสร้างใหม่ ไม่งั้นจะได้แชทซ้ำ
      // (อย่าแตะ platform_conv_id เพราะ webhook ยังใช้ค่าเดิมส่งข้อมูลเข้ามา)
      const { error } = await db.from("conversations").update(row).eq("id", prev.id);
      if (error) { console.error("conv update:", error); continue; }
      conv = { id: prev.id };
    } else {
      const { data, error } = await db
        .from("conversations")
        .insert({
          ...row,
          platform,
          platform_conv_id: String(c.convId),
          customer_name: c.name || "ลูกค้า",
        })
        .select("id")
        .single();
      if (error || !data) { console.error("conv insert:", error); continue; }
      conv = data;
    }
    convCount++;

    if (!norm.length) continue;   // มีแค่ข้อความล่าสุด ไม่มีเนื้อหาให้บันทึก

    // ── เทียบกับของเดิมก่อนบันทึก ─────────────────────────
    // แยกเป็น 2 กอง:
    //   byId    = เคยเก็บแล้วและมีรหัสจากแพลตฟอร์ม
    //   orphans = แถวที่ยังไม่มีรหัส = ข้อความที่ "ส่งจาก Chat Hub" เมื่อครู่
    //             อีกสักพักแพลตฟอร์มจะส่งข้อความเดียวกันนี้กลับมาพร้อมรหัสจริง
    //             ถ้าไม่จับคู่ให้ จะกลายเป็นข้อความเบิ้ล 2 อัน
    const { data: existing } = await db
      .from("messages")
      .select("id, platform_msg_id, direction, content, sent_at")
      .eq("conversation_id", conv.id)
      .order("sent_at", { ascending: false })
      .limit(300);

    const byId = new Map<string, any>();
    const orphans: any[] = [];
    for (const r of existing ?? []) {
      if (r.platform_msg_id) byId.set(String(r.platform_msg_id), r);
      else orphans.push(r);
    }

    const NEAR = 10 * 60 * 1000;   // ถือว่าเป็นข้อความเดียวกันถ้าห่างกันไม่เกิน 10 นาที
    const rows: Record<string, unknown>[] = [];

    for (const m of norm) {
      // รหัสขึ้นต้นด้วย local: = ดักจากตอนกดส่งในหน้าเว็บ ยังไม่รู้รหัสจริงของแพลตฟอร์ม
      const realId = m.id.startsWith("local:") ? null : m.id;

      // 1) เคยเก็บแล้ว — แต่ถ้าทิศทางเคยบันทึกผิด (เช่น Shopee แยกฝั่งพลาด) ให้แก้ให้ถูก
      if (realId && byId.has(realId)) {
        const old = byId.get(realId);
        if (old.direction !== m.direction) {
          await db.from("messages").update({ direction: m.direction }).eq("id", old.id);
          old.direction = m.direction;
        }
        continue;
      }

      // 2) ตรงกับข้อความที่ส่งจาก Chat Hub — เติมรหัสให้แถวเดิม ไม่สร้างแถวใหม่
      const t = Date.parse(m.sent_at);
      const k = orphans.findIndex((o) =>
        o.direction === m.direction &&
        o.content === m.content &&
        Math.abs(Date.parse(o.sent_at) - t) < NEAR);

      if (k >= 0) {
        const twin = orphans.splice(k, 1)[0];
        if (realId && twin.id) {
          await db.from("messages")
            .update({ platform_msg_id: realId, status: "sent" })
            .eq("id", twin.id);
          byId.set(realId, twin);
        }
        continue;
      }

      rows.push({
        conversation_id: conv.id,
        direction: m.direction,
        content: m.content,
        message_type: m.message_type,
        platform_msg_id: realId,          // local: → เก็บเป็น null รอรหัสจริงมาเติมทีหลัง
        status: "sent",
        sent_at: m.sent_at,
      });

      // กันซ้ำกันเองภายในชุดเดียวกัน
      const stub = { id: null, direction: m.direction, content: m.content, sent_at: m.sent_at };
      if (realId) byId.set(realId, stub); else orphans.push(stub);
    }

    if (rows.length) {
      const { error: insErr } = await db.from("messages").insert(rows);
      if (insErr) console.error("msg insert:", insErr);
      else msgCount += rows.length;
    }
  }

  return json({ ok: true, conversations: convCount, newMessages: msgCount });
});
