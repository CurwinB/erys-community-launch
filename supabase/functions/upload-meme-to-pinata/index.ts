// Brand-new edge function: pins a single meme image to Pinata and returns
// a dedicated-gateway URL. Has zero connection to the launch / on-chain
// pipeline — it only handles file uploads for the Launch Profile UI.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_BYTES = 4 * 1024 * 1024; // 4 MB
const ALLOWED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
]);

function errorResponse(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  const PINATA_JWT = Deno.env.get("PINATA_JWT");
  if (!PINATA_JWT) {
    return errorResponse("PINATA_JWT secret is not configured", 500);
  }

  const PINATA_GATEWAY_DOMAIN = (Deno.env.get("PINATA_GATEWAY_DOMAIN") ?? "")
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");

  const buildIpfsUrl = (cid: string): string =>
    PINATA_GATEWAY_DOMAIN
      ? `https://${PINATA_GATEWAY_DOMAIN}/ipfs/${cid}`
      : `https://ipfs.io/ipfs/${cid}`;

  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return errorResponse("Missing 'file' in multipart body", 400);
    }
    if (file.size > MAX_BYTES) {
      return errorResponse("File exceeds 4 MB limit", 413);
    }
    const contentType = (file.type || "").toLowerCase();
    if (!ALLOWED_TYPES.has(contentType)) {
      return errorResponse(
        "Unsupported file type. Allowed: png, jpeg, gif, webp",
        415
      );
    }

    const ext = contentType.split("/")[1]?.split(";")[0] || "png";
    const fileName = `${crypto.randomUUID()}.${ext}`;

    const pinForm = new FormData();
    pinForm.append("file", file, fileName);
    pinForm.append("network", "public");

    const pinRes = await fetch("https://uploads.pinata.cloud/v3/files", {
      method: "POST",
      headers: { Authorization: `Bearer ${PINATA_JWT}` },
      body: pinForm,
    });

    if (!pinRes.ok) {
      const text = await pinRes.text();
      return errorResponse(
        `Pinata upload failed (${pinRes.status}): ${text}`,
        502
      );
    }

    const pinData = await pinRes.json();
    const cid = pinData?.data?.cid || pinData?.IpfsHash;
    if (!cid) {
      return errorResponse("Pinata returned no CID", 502);
    }

    return new Response(JSON.stringify({ url: buildIpfsUrl(cid), cid }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResponse(`Upload error: ${message}`, 500);
  }
});