import { getProfileCoins } from "@zoralabs/coins-sdk";

function toHttpUrl(uri) {
  if (typeof uri !== "string" || uri.length === 0) return undefined;
  if (uri.startsWith("ipfs://")) return `https://ipfs.io/ipfs/${uri.slice(7)}`;
  if (uri.startsWith("ar://")) return `https://arweave.net/${uri.slice(5)}`;
  return uri;
}

function parseList(raw, fallback) {
  if (!raw) return fallback;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function withTimeout(promise, ms, label = "timeout") {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(label)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJsonSafe(url) {
  if (!url) return undefined;
  try {
    const res = await withTimeout(fetch(url, { cache: "no-store" }), 9000, "metadata-timeout");
    if (!res.ok) return undefined;
    const json = await res.json();
    if (!json || typeof json !== "object") return undefined;
    return json;
  } catch {
    return undefined;
  }
}

async function probeContentType(url) {
  if (!url) return { contentType: undefined, status: undefined, via: "none" };

  try {
    const head = await withTimeout(
      fetch(url, { method: "HEAD", redirect: "follow", cache: "no-store" }),
      8000,
      "head-timeout"
    );
    const contentType = head.headers.get("content-type") ?? undefined;
    if (contentType) {
      return { contentType, status: head.status, via: "head" };
    }
  } catch {
    // Fallback below.
  }

  try {
    const get = await withTimeout(
      fetch(url, {
        method: "GET",
        headers: { range: "bytes=0-0" },
        redirect: "follow",
        cache: "no-store",
      }),
      9000,
      "get-timeout"
    );
    const contentType = get.headers.get("content-type") ?? undefined;
    return { contentType, status: get.status, via: "get-range" };
  } catch {
    return { contentType: undefined, status: undefined, via: "error" };
  }
}

function classifyByMime(mime) {
  if (!mime) return "unknown";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  return "unknown";
}

function pickMedia(coin, metadata) {
  const mc = coin.mediaContent || {};

  if (typeof mc.mimeType === "string" && mc.mimeType.startsWith("image/")) {
    const preview = mc.previewImage?.medium || mc.previewImage?.small;
    const mediaUrl = preview || (mc.originalUri ? toHttpUrl(mc.originalUri) : undefined);
    return {
      mediaUrl,
      mediaMimeType: mc.mimeType,
      source: preview ? "mediaContent.previewImage" : "mediaContent.originalUri",
    };
  }

  if (typeof mc.mimeType === "string" && mc.mimeType.startsWith("video/")) {
    return {
      mediaUrl: mc.originalUri ? toHttpUrl(mc.originalUri) : undefined,
      mediaMimeType: mc.mimeType,
      source: "mediaContent.originalUri",
    };
  }

  const animationUrl = typeof metadata?.animation_url === "string" ? metadata.animation_url : undefined;
  const image = typeof metadata?.image === "string" ? metadata.image : undefined;
  const candidate = animationUrl || image;

  return {
    mediaUrl: candidate ? toHttpUrl(candidate) : undefined,
    mediaMimeType: typeof mc.mimeType === "string" ? mc.mimeType : undefined,
    source: animationUrl ? "metadata.animation_url" : image ? "metadata.image" : "none",
  };
}

function printRow(row) {
  const cols = [
    row.profile,
    row.createdAt || "",
    row.coinName || "",
    row.source || "",
    row.declaredMime || "",
    row.probedMime || "",
    row.declaredType || "",
    row.probedType || "",
    row.mediaUrl || "",
  ];
  console.log(cols.join("\t"));
}

async function main() {
  const defaultProfiles = [
    "cyshimi",
    "seedcomputer",
    "rebudigital",
    "brendyzinha",
    "elbi",
    "tir3d",
    "lucasborges",
    "pwdro",
    "l444u",
    "qabqabqab",
    "4nd7ro",
    "femzor",
    "ileogivel",
  ];

  const profiles = parseList(process.env.PROFILES, defaultProfiles);
  const countPerProfile = Number(process.env.COUNT || "12");
  const maxRows = Number(process.env.MAX_ROWS || "120");

  console.log(`# profiles=${profiles.length} countPerProfile=${countPerProfile} maxRows=${maxRows}`);
  console.log(
    [
      "profile",
      "createdAt",
      "coinName",
      "source",
      "declaredMime",
      "probedMime",
      "declaredType",
      "probedType",
      "mediaUrl",
    ].join("\t")
  );

  let rows = 0;
  for (const identifier of profiles) {
    if (rows >= maxRows) break;

    let r;
    try {
      r = await withTimeout(getProfileCoins({ identifier, count: countPerProfile }), 7000, "coins-timeout");
    } catch (err) {
      console.error(`ERROR\t${identifier}\trequest-failed\t${String(err)}`);
      continue;
    }

    const err = "error" in r ? r.error : undefined;
    if (err) {
      console.error(`ERROR\t${identifier}\tapi-error\t${String(err)}`);
      continue;
    }

    const data = "data" in r ? r.data : undefined;
    const coins = data?.profile?.createdCoins?.edges?.map((e) => e.node) ?? [];

    for (const coin of coins) {
      if (rows >= maxRows) break;

      const tokenUri = toHttpUrl(coin.tokenUri);
      const metadata = await fetchJsonSafe(tokenUri);
      const picked = pickMedia(coin, metadata);
      const probe = await probeContentType(picked.mediaUrl);

      const declaredType = classifyByMime(picked.mediaMimeType);
      const probedType = classifyByMime(probe.contentType);

      printRow({
        profile: identifier,
        createdAt: coin.createdAt,
        coinName: coin.name,
        source: picked.source,
        declaredMime: picked.mediaMimeType,
        probedMime: probe.contentType,
        declaredType,
        probedType,
        mediaUrl: picked.mediaUrl,
      });

      rows += 1;
    }
  }

  console.log(`# done rows=${rows}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
