// ============================================================
//  Rattana Unified Inbox — LINE OA Webhook
//  Deploy: Supabase Dashboard > Edge Functions > New Function
//  Name: webhook-line
// ============================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CHANNEL_SECRET = Deno.env.get("LINE_CHANNEL_SECRET") ?? "";
const ACCESS_TOKEN   = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN") ?? "";
const SUPABASE_URL   = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// ── ดึงชื่อ + รูปโปรไฟล์ลูกค้าจาก LINE ────────────────────
// เรียกเฉพาะตอนที่ยังไม่มีชื่อ เพื่อไม่ให้ยิง API ทุกข้อความ
async function fetchProfile(userId: string) {
  if (!ACCESS_TOKEN || !userId) return null;
  try {
    const res = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    });
    if (!res.ok) { console.error("profile fetch:", res.status, await res.text()); return null; }
    const p = await res.json();
    return { name: p.displayName as string | undefined, avatar: p.pictureUrl as string | undefined };
  } catch (e) {
    console.error("profile error:", String(e));
    return null;
  }
}

// ── ตรวจสอบ HMAC-SHA256 signature ──────────────────────────
async function verifySignature(body: string, sig: string): Promise<boolean> {
  // fail closed — ถ้าไม่มี secret ต้องปฏิเสธ ไม่ใช่ปล่อยผ่าน
  // (Verify JWT ปิดอยู่ ลายเซ็นนี้จึงเป็นด่านเดียวที่กันคนยิงข้อความปลอม)
  if (!CHANNEL_SECRET) {
    console.error("LINE_CHANNEL_SECRET ยังไม่ได้ตั้ง — ปฏิเสธ request ทั้งหมด");
    return false;
  }
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
    if (event.type !== "message") continue;

    const m = event.message;
    // แปลงข้อความแต่ละชนิดเป็น content ที่เก็บได้
    //  - text    : เก็บข้อความตรงๆ
    //  - sticker : เก็บ "URL รูปสติกเกอร์" ไว้ใน content (ฝั่งแอพเช็ค message_type แล้วเอาไป <img>)
    //  - อื่นๆ    : เก็บข้อความอธิบายไว้ก่อน (ไฟล์จริงต้องดึงผ่าน API ด้วย token — ทำทีหลังได้)
    let text: string;
    let preview: string;
    switch (m.type) {
      case "text":
        text = m.text; preview = m.text; break;
      case "sticker":
        text = `https://stickershop.line-scdn.net/stickershop/v1/sticker/${m.stickerId}/android/sticker.png`;
        preview = "[สติกเกอร์]"; break;
      case "image":    text = "[รูปภาพ]";       preview = text; break;
      case "video":    text = "[วิดีโอ]";        preview = text; break;
      case "audio":    text = "[ข้อความเสียง]";  preview = text; break;
      case "file":     text = `[ไฟล์] ${m.fileName ?? ""}`.trim(); preview = text; break;
      case "location": text = `[ตำแหน่ง] ${m.address ?? m.title ?? ""}`.trim(); preview = text; break;
      default:         text = `[${m.type}]`;    preview = text; break;
    }

    const platformConvId = event.source.groupId ?? event.source.roomId ?? event.source.userId;
    const ts   = new Date(event.timestamp).toISOString();

    // upsert conversation
    // mark_read_token: เก็บไว้ให้แอพเรียก markAsRead ตอนพนักงานเปิดอ่าน
    const { data: conv, error: convErr } = await db
      .from("conversations")
      .upsert({
        platform: "line",
        platform_conv_id: platformConvId,
        customer_id: event.source.userId,
        last_message: preview,
        last_message_at: ts,
        // token อยู่ใน message ไม่ใช่ระดับ event — และ "ไม่ได้มาทุกครั้ง" ตามเอกสาร
        // จึงต้องคง token เดิมไว้ถ้ารอบนี้ไม่มีมา (อย่าเขียนทับด้วย null)
        ...(m.markAsReadToken ? { mark_read_token: m.markAsReadToken } : {}),
      }, { onConflict: "platform,platform_conv_id" })
      .select("id, customer_name, avatar_url")
      .single();

    if (convErr || !conv) { console.error("conv upsert:", convErr); continue; }

    // ดึงโปรไฟล์ครั้งเดียวตอนยังไม่มีชื่อ (แชทกลุ่มไม่มี userId ก็ข้ามไป)
    if ((!conv.customer_name || conv.customer_name === "ลูกค้า" || !conv.avatar_url) && event.source.userId) {
      const prof = await fetchProfile(event.source.userId);
      if (prof) {
        await db.from("conversations").update({
          customer_name: prof.name ?? conv.customer_name,
          avatar_url:    prof.avatar ?? conv.avatar_url,
        }).eq("id", conv.id);
      }
    }

    // insert message
    await db.from("messages").insert({
      conversation_id: conv.id,
      direction: "in",
      content: text,
      message_type: m.type,
      platform_msg_id: m.id,
      sent_at: ts,
    });

    // เพิ่ม unread
    await db.rpc("increment_unread", { conv_id: conv.id });
  }

  return new Response("OK", { status: 200 });
});
