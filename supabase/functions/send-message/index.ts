// ============================================================
//  Rattana Unified Inbox — Send Message (ตอบกลับทุกแพลตฟอร์ม)
//  Deploy: Supabase Dashboard > Edge Functions > New Function
//  Name: send-message
// ============================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL  = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Platform tokens
const LINE_TOKEN    = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN") ?? "";
const FB_TOKEN      = Deno.env.get("FACEBOOK_PAGE_TOKEN") ?? "";
const TT_TOKEN      = Deno.env.get("TIKTOK_ACCESS_TOKEN") ?? "";
const SHOPEE_TOKEN  = Deno.env.get("SHOPEE_ACCESS_TOKEN") ?? "";
const TTS_TOKEN     = Deno.env.get("TIKTOKSHOP_ACCESS_TOKEN") ?? "";

// ── ส่ง LINE ─────────────────────────────────────────────────
async function sendLine(to: string, text: string) {
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${LINE_TOKEN}` },
    body: JSON.stringify({ to, messages: [{ type: "text", text }] }),
  });
  if (!res.ok) throw new Error(`LINE error: ${await res.text()}`);
}

// ── ส่ง Facebook ─────────────────────────────────────────────
async function sendFacebook(recipientId: string, text: string) {
  const res = await fetch(
    `https://graph.facebook.com/v19.0/me/messages?access_token=${FB_TOKEN}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipient: { id: recipientId }, message: { text } }),
    }
  );
  if (!res.ok) throw new Error(`Facebook error: ${await res.text()}`);
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

  const { conversationId, content } = await req.json();
  if (!conversationId || !content) {
    return new Response(JSON.stringify({ error: "missing fields" }), { status: 400, headers: corsHeaders });
  }

  const db = createClient(SUPABASE_URL, SERVICE_KEY);

  // ดึงข้อมูล conversation
  const { data: conv } = await db
    .from("conversations")
    .select("platform, platform_conv_id")
    .eq("id", conversationId)
    .single();

  if (!conv) return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: corsHeaders });

  let sent = false;
  let errMsg = "";

  try {
    switch (conv.platform) {
      case "line":        await sendLine(conv.platform_conv_id, content);        sent = true; break;
      case "facebook":    await sendFacebook(conv.platform_conv_id, content);    sent = true; break;
      case "tiktok":      await sendTikTok(conv.platform_conv_id, content);      sent = true; break;
      case "shopee":      await sendShopee(conv.platform_conv_id, content);      sent = true; break;
      case "tiktokshop":  await sendTikTokShop(conv.platform_conv_id, content);  sent = true; break;
      default: errMsg = `Platform ${conv.platform} not configured`;
    }
  } catch (e) {
    errMsg = String(e);
    console.error("send-message error:", errMsg);
  }

  // ไม่บันทึกข้อความที่นี่ — ฝั่งแอพบันทึกลง DB ไปแล้วก่อนเรียกฟังก์ชันนี้
  // (ถ้าบันทึกซ้ำตรงนี้จะได้ข้อความซ้ำ 2 อัน เมื่อส่งเข้าแพลตฟอร์มสำเร็จ)
  // หน้าที่ของฟังก์ชันนี้คือ "ส่งเข้าแพลตฟอร์ม" อย่างเดียว แล้วรายงานผลกลับ

  return new Response(JSON.stringify({ sent, error: errMsg || null }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
