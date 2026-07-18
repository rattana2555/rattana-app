// ============================================================
//  Rattana Unified Inbox — LINE OA Webhook
//  Deploy: Supabase Dashboard > Edge Functions > New Function
//  Name: webhook-line
// ============================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CHANNEL_SECRET = Deno.env.get("LINE_CHANNEL_SECRET") ?? "";
const SUPABASE_URL   = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// ── ตรวจสอบ HMAC-SHA256 signature ──────────────────────────
async function verifySignature(body: string, sig: string): Promise<boolean> {
  if (!CHANNEL_SECRET) return true; // skip in dev
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(CHANNEL_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return sig === expected;
}

serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*" } });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const body = await req.text();
  const sig  = req.headers.get("x-line-signature") ?? "";

  if (!(await verifySignature(body, sig))) {
    console.error("LINE signature mismatch");
    return new Response("Unauthorized", { status: 401 });
  }

  const db = createClient(SUPABASE_URL, SERVICE_KEY);
  const { events = [] } = JSON.parse(body);

  for (const event of events) {
    // รับแค่ text message ก่อน (เพิ่ม image/sticker ทีหลังได้)
    if (event.type !== "message" || event.message.type !== "text") continue;

    const platformConvId = event.source.groupId ?? event.source.roomId ?? event.source.userId;
    const text = event.message.text as string;
    const ts   = new Date(event.timestamp).toISOString();

    // upsert conversation
    const { data: conv, error: convErr } = await db
      .from("conversations")
      .upsert({
        platform: "line",
        platform_conv_id: platformConvId,
        customer_id: event.source.userId,
        last_message: text,
        last_message_at: ts,
      }, { onConflict: "platform,platform_conv_id" })
      .select("id")
      .single();

    if (convErr || !conv) { console.error("conv upsert:", convErr); continue; }

    // insert message
    await db.from("messages").insert({
      conversation_id: conv.id,
      direction: "in",
      content: text,
      platform_msg_id: event.message.id,
      sent_at: ts,
    });

    // เพิ่ม unread
    await db.rpc("increment_unread", { conv_id: conv.id });
  }

  return new Response("OK", { status: 200 });
});
