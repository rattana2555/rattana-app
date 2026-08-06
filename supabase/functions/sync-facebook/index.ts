// ============================================================
//  Rattana Chat Hub — Sync Facebook (ดึงบทสนทนาจากเพจมาลง Chat Hub)
//  Deploy: Supabase Dashboard > Edge Functions > New Function
//  Name: sync-facebook
//
//  ทำไมต้องดึงแทนการรอ webhook:
//  เพจนี้มี AI ตอบลูกค้าอยู่ก่อนแล้ว AI จึงเป็น "เจ้าของบทสนทนา"
//  Meta จะส่ง webhook ไปให้เจ้าของเท่านั้น แอพเราจึงไม่ได้รับอะไรเลย
//  การดึงผ่าน Graph API ข้ามปัญหานี้ และได้เปรียบกว่า:
//    - เห็นข้อความที่ AI/แอดมินตอบด้วย (webhook ไม่ให้)
//    - ดึงบทสนทนาเก่าย้อนหลังได้
// ============================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PAGE_TOKEN   = Deno.env.get("FACEBOOK_PAGE_TOKEN") ?? "";
const PAGE_ID      = Deno.env.get("FACEBOOK_PAGE_ID") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const GRAPH = "https://graph.facebook.com/v25.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization,content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (!PAGE_TOKEN || !PAGE_ID) {
    return new Response(
      JSON.stringify({ error: "ยังไม่ได้ตั้ง FACEBOOK_PAGE_TOKEN หรือ FACEBOOK_PAGE_ID" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // จำนวนบทสนทนาที่ดึงต่อรอบ (เรียงตามอัพเดตล่าสุด) — ปรับได้ผ่าน ?limit=
  const url = new URL(req.url);
  const convLimit = Math.min(Number(url.searchParams.get("limit") ?? 25), 50);
  const msgLimit  = Math.min(Number(url.searchParams.get("messages") ?? 25), 50);

  const db = createClient(SUPABASE_URL, SERVICE_KEY);

  const fields =
    `id,updated_time,participants,messages.limit(${msgLimit})` +
    `{id,created_time,from,message,attachments{mime_type,name,file_url,image_data}}`;

  const res = await fetch(
    `${GRAPH}/${PAGE_ID}/conversations?platform=messenger` +
    `&fields=${encodeURIComponent(fields)}&limit=${convLimit}` +
    `&access_token=${encodeURIComponent(PAGE_TOKEN)}`,
  );

  if (!res.ok) {
    const detail = await res.text();
    console.error("graph error:", detail);
    return new Response(JSON.stringify({ error: "ดึงข้อมูลจาก Facebook ไม่ได้", detail }), {
      status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const data = await res.json();
  let convCount = 0, msgCount = 0;

  for (const c of data.data ?? []) {
    // หา "ลูกค้า" = ผู้ร่วมสนทนาที่ไม่ใช่เพจ
    const customer = (c.participants?.data ?? []).find((p: any) => p.id !== PAGE_ID);
    if (!customer) continue;

    const msgs = (c.messages?.data ?? []).slice().reverse(); // เก่า → ใหม่
    if (!msgs.length) continue;

    const last = msgs[msgs.length - 1];

    // รูปโปรไฟล์: participants ของ Conversations API ไม่มีรูปให้
    // ต้องถาม User Profile API แยก — ใช้ได้ต่อเมื่อ PSID ผูกกับแอพเราแล้ว
    // (เกิดขึ้นเมื่อเปิด "เข้าถึงช่องสำรอง" ใน Conversation Routing)
    // ดึงเฉพาะรายที่ยังไม่มีรูป เพื่อไม่ให้ยิง API ซ้ำทุกรอบ
    const { data: prev } = await db
      .from("conversations")
      .select("avatar_url")
      .eq("platform", "facebook")
      .eq("platform_conv_id", customer.id)
      .maybeSingle();

    let avatar = prev?.avatar_url ?? null;
    if (!avatar) {
      try {
        const pr = await fetch(
          `${GRAPH}/${customer.id}?fields=profile_pic&access_token=${encodeURIComponent(PAGE_TOKEN)}`,
        );
        if (pr.ok) avatar = (await pr.json()).profile_pic ?? null;
      } catch (_) { /* ไม่มีรูปก็ไม่เป็นไร ใช้ตัวอักษรแทน */ }
    }

    const { data: conv, error: convErr } = await db
      .from("conversations")
      .upsert({
        platform: "facebook",
        platform_conv_id: customer.id,      // PSID — ใช้ส่งข้อความกลับได้
        customer_id: customer.id,
        customer_name: customer.name ?? "ลูกค้า",
        avatar_url: avatar,
        last_message: last.message ?? "",
        last_message_at: new Date(last.created_time).toISOString(),
      }, { onConflict: "platform,platform_conv_id" })
      .select("id")
      .single();

    if (convErr || !conv) { console.error("conv upsert:", convErr); continue; }
    convCount++;

    // ข้อความที่มีอยู่แล้ว — กันบันทึกซ้ำโดยเทียบ platform_msg_id
    const { data: existing } = await db
      .from("messages")
      .select("id,platform_msg_id,message_type")
      .eq("conversation_id", conv.id)
      .not("platform_msg_id", "is", null);
    const seen = new Map((existing ?? []).map((m: any) => [m.platform_msg_id, m]));

    const rows = [];
    for (const m of msgs) {
      const shaped = shape(m);
      if (!shaped) continue;                    // ไม่มีทั้งข้อความและไฟล์แนบ → ข้าม
      const old = seen.get(m.id);
      if (old) {
        // ลิงก์รูปของ Facebook เป็นแบบมีวันหมดอายุ — sync ทุกรอบให้ลิงก์ใหม่เสมอ
        if (shaped.message_type !== "text") {
          await db.from("messages").update({ content: shaped.content }).eq("id", old.id);
        }
        continue;
      }
      rows.push({
        conversation_id: conv.id,
        direction: m.from?.id === PAGE_ID ? "out" : "in",
        platform_msg_id: m.id,
        status: "sent",
        sent_at: new Date(m.created_time).toISOString(),
        ...shaped,
      });
    }

    if (rows.length) {
      const { error: insErr } = await db.from("messages").insert(rows);
      if (insErr) console.error("msg insert:", insErr);
      else msgCount += rows.length;
    }
  }

  return new Response(
    JSON.stringify({ ok: true, conversations: convCount, newMessages: msgCount }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
