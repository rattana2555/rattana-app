// ============================================================
//  Rattana Unified Inbox — Facebook Page Webhook
//  Deploy: Supabase Dashboard > Edge Functions > New Function
//  Name: webhook-facebook
// ============================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const VERIFY_TOKEN = Deno.env.get("FACEBOOK_VERIFY_TOKEN") ?? "rattana_verify_2025";
const SUPABASE_URL  = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

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

  const body = await req.json();
  if (body.object !== "page") return new Response("Not a page event", { status: 200 });

  const db = createClient(SUPABASE_URL, SERVICE_KEY);

  for (const entry of body.entry ?? []) {
    for (const msg of entry.messaging ?? []) {
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
