// ============================================================
//  Rattana Unified Inbox — Send Message (ตอบกลับทุกแพลตฟอร์ม)
//  Deploy: Supabase Dashboard > Edge Functions > New Function
//  Name: send-message
// ============================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL  = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY   = Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Platform tokens
const LINE_TOKEN    = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN") ?? "";
const FB_TOKEN      = Deno.env.get("FACEBOOK_PAGE_TOKEN") ?? "";
const TT_TOKEN      = Deno.env.get("TIKTOK_ACCESS_TOKEN") ?? "";
const SHOPEE_TOKEN  = Deno.env.get("SHOPEE_ACCESS_TOKEN") ?? "";
const TTS_TOKEN     = Deno.env.get("TIKTOKSHOP_ACCESS_TOKEN") ?? "";

// ── ส่ง LINE ─────────────────────────────────────────────────
// คืน "รหัสข้อความของแพลตฟอร์ม" กลับมาด้วย — สำคัญมาก
// เพราะอีกสักครู่ตัวดึงข้อมูล (bridge/sync) จะเจอข้อความเดียวกันนี้อีกรอบ
// ถ้าแถวเดิมไม่มีรหัสไว้เทียบ มันจะบันทึกซ้ำกลายเป็นข้อความเบิ้ล
async function sendLine(to: string, text: string): Promise<string | null> {
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${LINE_TOKEN}` },
    body: JSON.stringify({ to, messages: [{ type: "text", text }] }),
  });
  const body = await res.text();
  // LINE ใช้ข้อความเดียว "Failed to send messages" กับหลายสาเหตุมาก
  // ต้องดูรหัส HTTP ถึงจะรู้ว่าเกิดอะไรขึ้นจริง แล้วแปลเป็นภาษาคนให้พนักงานอ่านรู้เรื่อง
  if (!res.ok) {
    const why =
      res.status === 429 ? "โควตาข้อความ LINE ของเดือนนี้หมดแล้ว"
    : res.status === 401 ? "โทเคน LINE ไม่ถูกต้องหรือหมดอายุ"
    : res.status === 403 ? "แพ็กเกจ LINE ปัจจุบันส่งข้อความหาลูกค้าโดยตรงไม่ได้"
    : res.status === 400 ? "LINE ไม่รู้จักลูกค้ารายนี้ — ตอบใน LINE OA Manager แทน"
    : `LINE ${res.status}: ${body}`;
    throw new Error(why);
  }
  try { return JSON.parse(body)?.sentMessages?.[0]?.id ?? null; } catch { return null; }
}

// ── ส่งรูปทาง LINE ───────────────────────────────────────────
// LINE ต้องการ URL รูปแบบ HTTPS สาธารณะ 2 อัน (ตัวเต็ม + ตัวพรีวิว) ใช้ URL เดียวกันได้
async function sendLineImage(to: string, url: string): Promise<string | null> {
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${LINE_TOKEN}` },
    body: JSON.stringify({ to, messages: [{ type: "image", originalContentUrl: url, previewImageUrl: url }] }),
  });
  const body = await res.text();
  if (!res.ok) {
    const why =
      res.status === 429 ? "โควตาข้อความ LINE ของเดือนนี้หมดแล้ว"
    : res.status === 401 ? "โทเคน LINE ไม่ถูกต้องหรือหมดอายุ"
    : res.status === 400 ? "LINE ไม่รู้จักลูกค้ารายนี้ — ตอบใน LINE OA Manager แทน"
    : `LINE ${res.status}: ${body}`;
    throw new Error(why);
  }
  try { return JSON.parse(body)?.sentMessages?.[0]?.id ?? null; } catch { return null; }
}

// Facebook คืน error เป็นก้อน JSON ยาวมาก พนักงานอ่านไม่รู้เรื่อง
// แปลเป็นประโยคเดียวที่บอกได้ว่า "ต้องทำอะไรต่อ"
function fbReason(status: number, body: string): string {
  let e: Record<string, unknown> = {};
  try { e = (JSON.parse(body) as any)?.error ?? {}; } catch { /* ไม่ใช่ JSON ก็ช่างมัน */ }
  const sub  = Number(e.error_subcode ?? 0);
  const code = Number(e.code ?? 0);
  const msg  = String(e.message ?? "");

  if (sub === 2018278 || /outside of allowed window/i.test(msg))
    return "เกินกำหนด 24 ชั่วโมงที่ Facebook ให้ตอบ — ต้องรอลูกค้าทักมาใหม่ก่อน";
  if (/controlling this thread/i.test(msg))
    return "บทสนทนานี้มีแอปอื่นของเพจควบคุมอยู่ (เช่นแชทบอท AI) — ต้องเปิดสิทธิ์ควบคุมการสนทนาให้แอปนี้ก่อน";
  if (code === 551 || sub === 1545041)
    return "ลูกค้าปิดรับข้อความจากเพจนี้";
  if (code === 200 || /permission/i.test(msg))
    return "โทเคนเพจไม่มีสิทธิ์ส่งข้อความ — ออก Page Token ใหม่พร้อมสิทธิ์ pages_messaging";
  if (code === 100)
    return "Facebook ไม่รู้จักลูกค้ารายนี้";
  return `Facebook ${status}: ${msg || body}`.slice(0, 200);
}

// ── ส่ง Facebook ─────────────────────────────────────────────
// messaging_type: RESPONSE = ตอบกลับข้อความลูกค้าภายใน 24 ชม. (ไม่ต้องขอสิทธิ์เพิ่ม)
// recipientId คือ PSID จาก sender.id ของ webhook — ใช้ได้เฉพาะกับเพจนี้เท่านั้น
async function sendFacebook(recipientId: string, text: string): Promise<string | null> {
  const res = await fetch(
    `https://graph.facebook.com/v25.0/me/messages?access_token=${encodeURIComponent(FB_TOKEN)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { id: recipientId },
        messaging_type: "RESPONSE",
        message: { text },
      }),
    }
  );
  const body = await res.text();
  if (!res.ok) throw new Error(fbReason(res.status, body));
  try { return JSON.parse(body)?.message_id ?? null; } catch { return null; }
}

// ── ส่งรูปทาง Facebook ───────────────────────────────────────
async function sendFacebookImage(recipientId: string, url: string): Promise<string | null> {
  const res = await fetch(
    `https://graph.facebook.com/v25.0/me/messages?access_token=${encodeURIComponent(FB_TOKEN)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { id: recipientId },
        messaging_type: "RESPONSE",
        message: { attachment: { type: "image", payload: { url, is_reusable: true } } },
      }),
    }
  );
  const body = await res.text();
  if (!res.ok) throw new Error(fbReason(res.status, body));
  try { return JSON.parse(body)?.message_id ?? null; } catch { return null; }
}

// ── ส่ง TikTok DM ────────────────────────────────────────────
async function sendTikTok(userId: string, text: string) {
  // TikTok Direct Message API (ต้องขอ permission จาก TikTok ก่อน)
  const res = await fetch("https://open.tiktokapis.com/v2/dm/conversation/message/create/", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${TT_TOKEN}` },
    body: JSON.stringify({ receiver_user_id: userId, content: { message_type: "text", text } }),
  });
  if (!res.ok) throw new Error(`TikTok error: ${await res.text()}`);
}

// ── ส่ง Shopee Chat ──────────────────────────────────────────
async function sendShopee(conversationId: string, text: string) {
  // Shopee Chat API v2
  const res = await fetch("https://partner.shopeemobile.com/api/v2/sellerchat/send_message", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SHOPEE_TOKEN}` },
    body: JSON.stringify({ conversation_id: conversationId, message_type: "text", content: { text } }),
  });
  if (!res.ok) throw new Error(`Shopee error: ${await res.text()}`);
}

// ── ส่ง TikTok Shop ──────────────────────────────────────────
async function sendTikTokShop(conversationId: string, text: string) {
  const res = await fetch("https://open-api.tiktokglobalshop.com/customer_service/202309/conversations/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-tts-access-token": TTS_TOKEN },
    body: JSON.stringify({ conversation_id: conversationId, message_type: "TEXT", content: text }),
  });
  if (!res.ok) throw new Error(`TikTokShop error: ${await res.text()}`);
}

// ── Main handler ─────────────────────────────────────────────
serve(async (req: Request) => {
  const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization,content-type" };
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const { conversationId, content, action, messageId, lineUserId } = await req.json();

  // ── ตรวจสภาพช่องทาง LINE (ใช้ตอนส่งไม่ผ่านแล้วอยากรู้ว่าเพราะอะไร) ──
  // ลบทิ้งได้เมื่อแก้ปัญหาเสร็จ — ไม่ใช่ส่วนที่ใช้งานประจำ
  if (action === "diag") {
    const out: Record<string, unknown> = {};
    const probe = async (k: string, url: string) => {
      try {
        const r = await fetch(url, { headers: { Authorization: `Bearer ${LINE_TOKEN}` } });
        out[k] = { status: r.status, body: (await r.text()).slice(0, 300) };
      } catch (e) { out[k] = { error: String(e) }; }
    };
    out.hasToken = LINE_TOKEN ? `ยาว ${LINE_TOKEN.length} ตัวอักษร` : "ไม่ได้ตั้งค่า";
    await probe("botInfo", "https://api.line.me/v2/bot/info");
    await probe("quota",   "https://api.line.me/v2/bot/message/quota");
    await probe("used",    "https://api.line.me/v2/bot/message/quota/consumption");
    if (lineUserId) await probe("profile", `https://api.line.me/v2/bot/profile/${lineUserId}`);
    return new Response(JSON.stringify(out, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!conversationId) {
    return new Response(JSON.stringify({ error: "missing conversationId" }), { status: 400, headers: corsHeaders });
  }

  const db = createClient(SUPABASE_URL, SERVICE_KEY);

  // ดึงข้อมูล conversation
  const { data: conv } = await db
    .from("conversations")
    .select("platform, platform_conv_id, mark_read_token, customer_id")
    .eq("id", conversationId)
    .single();

  if (!conv) return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: corsHeaders });

  // ── บอก LINE ว่าทีมงานอ่านข้อความแล้ว (ลูกค้าจะเห็น "อ่านแล้ว") ──
  // ต้องเปิด "แชท" ใน LINE OA Manager ถึงจะใช้ได้
  if (action === "markRead") {
    if (conv.platform !== "line" || !conv.mark_read_token) {
      return new Response(JSON.stringify({ ok: false, error: "no token" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const r = await fetch("https://api.line.me/v2/bot/chat/markAsRead", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${LINE_TOKEN}` },
      body: JSON.stringify({ markAsReadToken: conv.mark_read_token }),
    });
    const ok = r.ok;
    if (!ok) console.error("markAsRead:", r.status, await r.text());
    return new Response(JSON.stringify({ ok }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  if (!content) {
    return new Response(JSON.stringify({ error: "missing content" }), { status: 400, headers: corsHeaders });
  }

  let sent = false;
  let errMsg = "";
  let platformMsgId: string | null = null;

  try {
    switch (conv.platform) {
      // customer_id มาจาก webhook = รหัสที่ Messaging API ใช้ส่งได้จริง
      // ส่วน platform_conv_id ของแชทที่ส่วนขยายสร้างขึ้นเป็นรหัสของ OA Manager ซึ่งส่งไม่ได้
      case "line":        platformMsgId = await sendLine(conv.customer_id || conv.platform_conv_id, content); sent = true; break;
      case "facebook":    platformMsgId = await sendFacebook(conv.platform_conv_id, content); sent = true; break;
      case "tiktok":      await sendTikTok(conv.platform_conv_id, content);      sent = true; break;
      case "shopee":      await sendShopee(conv.platform_conv_id, content);      sent = true; break;
      case "tiktokshop":  await sendTikTokShop(conv.platform_conv_id, content);  sent = true; break;
      default: errMsg = `Platform ${conv.platform} not configured`;
    }
  } catch (e) {
    errMsg = String(e);
    console.error("send-message error:", errMsg);
  }

  // ไม่บันทึกข้อความใหม่ที่นี่ — ฝั่งแอพบันทึกลง DB ไปแล้วก่อนเรียกฟังก์ชันนี้
  // แต่ "ต้อง" เขียนรหัสข้อความของแพลตฟอร์มกลับเข้าแถวเดิม
  // ไม่งั้นเมื่อ bridge/sync ดึงข้อความเดียวกันกลับมา จะมองว่าเป็นข้อความใหม่ → เบิ้ล
  if (sent && messageId && platformMsgId) {
    const { error } = await db
      .from("messages")
      .update({ platform_msg_id: platformMsgId, status: "sent" })
      .eq("id", messageId);
    if (error) console.error("stamp platform_msg_id:", error);
  }

  return new Response(JSON.stringify({ sent, platformMsgId, error: errMsg || null }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
