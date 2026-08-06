// ============================================================
//  Rattana Unified Inbox — Facebook Page Webhook
//  Deploy: Supabase Dashboard > Edge Functions > New Function
//  Name: webhook-facebook
// ============================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const VERIFY_TOKEN = Deno.env.get("FACEBOOK_VERIFY_TOKEN") ?? "rattana_verify_2025";
const APP_SECRET   = Deno.env.get("FACEBOOK_APP_SECRET") ?? "";
const SUPABASE_URL  = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// ตรวจลายเซ็น X-Hub-Signature-256 ที่ Facebook แนบมากับทุก POST
// fail closed — ไม่มี secret = ปฏิเสธ (Verify JWT ปิดอยู่ ลายเซ็นนี้คือด่านเดียว)
async function verifySignature(body: string, header: string): Promise<boolean> {
  if (!APP_SECRET) {
    console.error("FACEBOOK_APP_SECRET ยังไม่ได้ตั้ง — ปฏิเสธ request ทั้งหมด");
    return false;
  }
  if (!header.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(APP_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const expected = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, "0")).join("");
  const given = header.slice(7);
  // เทียบแบบเวลาคงที่ กัน timing attack
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*" } });

  // ── Facebook webhook verification (GET) ──────────────────
  if (req.method === "GET") {
    const url       = new URL(req.url);
    const mode      = url.searchParams.get("hub.mode");
    const token     = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      return new Response(challenge ?? "", { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const raw = await req.text();
  const sig = req.headers.get("x-hub-signature-256") ?? "";
  if (!(await verifySignature(raw, sig))) {
    console.error("Facebook signature mismatch");
    return new Response("Unauthorized", { status: 401 });
  }

  const body = JSON.parse(raw);
  if (body.object !== "page") return new Response("Not a page event", { status: 200 });

  const db = createClient(SUPABASE_URL, SERVICE_KEY);

  for (const entry of body.entry ?? []) {
    // messaging = แอพเราเป็นเจ้าของบทสนทนา
    // standby   = แอพอื่นเป็นเจ้าของ (เช่น AI ของเพจ) — Meta ส่งมาให้ดูอย่างเดียว
    // ถ้ารับแค่ messaging จะไม่เห็นข้อความเลยเมื่อมี AI ครองบทสนทนาอยู่
    const events = [
      ...(entry.messaging ?? []),
      ...(entry.standby   ?? []),
    ];

    for (const msg of events) {
      if (!msg.message?.text) continue; // skip echo, read receipt, etc.
      if (msg.message.is_echo) continue; // skip our own outbound echo

      const senderId = msg.sender.id as string;
      const text     = msg.message.text as string;
      const ts       = new Date(msg.timestamp).toISOString();

      const { data: conv, error: convErr } = await db
        .from("conversations")
        .upsert({
          platform: "facebook",
          platform_conv_id: senderId,
          customer_id: senderId,
          last_message: text,
          last_message_at: ts,
        }, { onConflict: "platform,platform_conv_id" })
        .select("id")
        .single();

      if (convErr || !conv) { console.error("conv upsert:", convErr); continue; }

      await db.from("messages").insert({
        conversation_id: conv.id,
        direction: "in",
        content: text,
        platform_msg_id: msg.message.mid,
        sent_at: ts,
      });

      await db.rpc("increment_unread", { conv_id: conv.id });
    }
  }

  return new Response("OK", { status: 200 });
});
