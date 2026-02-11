import { NextResponse } from "next/server";
import { getHybridHomeFeedPage } from "@/lib/home-feed-cache";

const FEED_DEBUG = process.env.FEED_DEBUG === "1";

function logFeedServer(message: string, data?: Record<string, unknown>) {
  if (!FEED_DEBUG) return;
  const now = new Date().toISOString();
  if (data) {
    console.log(`[api/home/works ${now}] ${message}`, data);
    return;
  }
  console.log(`[api/home/works ${now}] ${message}`);
}

export async function GET(req: Request) {
  const startedAt = Date.now();
  const url = new URL(req.url);
  const after = url.searchParams.get("after") ?? undefined;
  const countRaw = Number(url.searchParams.get("count") ?? "36");
  const count = Number.isFinite(countRaw)
    ? Math.max(1, Math.min(80, Math.floor(countRaw)))
    : 36;
  logFeedServer("request start", {
    path: url.pathname,
    after: after ?? null,
    countRaw,
    count,
  });

  const fetchStartedAt = Date.now();
  const cached = await getHybridHomeFeedPage(after, count);
  logFeedServer("cache fetch done", {
    ms: Date.now() - fetchStartedAt,
    source: cached.source,
    items: cached.items.length,
    hasNextPage: cached.hasNextPage,
    nextCursor: cached.nextCursor ?? null,
  });

  logFeedServer("request done", {
    totalMs: Date.now() - startedAt,
    source: cached.source,
    total: cached.total,
    liveCount: cached.liveCount,
    cacheCount: cached.cacheCount,
  });

  return NextResponse.json({
    items: cached.items,
    nextCursor: cached.nextCursor,
    hasNextPage: cached.hasNextPage,
    source: cached.source,
    total: cached.total,
    liveCount: cached.liveCount,
    cacheCount: cached.cacheCount,
  });
}
