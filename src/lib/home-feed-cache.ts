import { promises as fs } from "node:fs";
import path from "node:path";
import { FEED_PROFILES } from "@/lib/profiles";
import { getHomeFeedNewerThan } from "@/lib/zora-feed";
import type { FeedItem } from "@/lib/zora-feed";

export type HomeFeedCacheFile = {
  version: number;
  generatedAt: string;
  profiles: string[];
  newestCreatedAt?: string;
  oldestCreatedAt?: string;
  total: number;
  items: FeedItem[];
};

const HOME_FEED_CACHE_PATH = path.join(
  process.cwd(),
  "data",
  "home-feed-cache.json"
);
const LIVE_REFRESH_TTL_MS = 60_000;
const LIVE_FETCH_TIMEOUT_MS = 1_500;

let liveMemo:
  | {
      key: string;
      at: number;
      items: FeedItem[];
    }
  | null = null;
let liveInFlight: Promise<FeedItem[]> | null = null;

function normalizeItems(items: FeedItem[]) {
  const deduped = new Map<string, FeedItem>();
  for (const item of items) {
    if (!item?.id) continue;
    if (!deduped.has(item.id)) deduped.set(item.id, item);
  }
  const next = Array.from(deduped.values());
  next.sort((a, b) => {
    const at = a.createdAt ? Date.parse(a.createdAt) : 0;
    const bt = b.createdAt ? Date.parse(b.createdAt) : 0;
    return bt - at;
  });
  return next;
}

export async function readHomeFeedCache(): Promise<HomeFeedCacheFile | null> {
  try {
    const raw = await fs.readFile(HOME_FEED_CACHE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<HomeFeedCacheFile>;
    const items = normalizeItems(Array.isArray(parsed.items) ? parsed.items : []);
    if (items.length === 0) return null;
    return {
      version: Number(parsed.version ?? 1),
      generatedAt:
        typeof parsed.generatedAt === "string"
          ? parsed.generatedAt
          : new Date().toISOString(),
      profiles: Array.isArray(parsed.profiles)
        ? parsed.profiles.filter((x): x is string => typeof x === "string")
        : [],
      newestCreatedAt: items[0]?.createdAt,
      oldestCreatedAt: items[items.length - 1]?.createdAt,
      total: items.length,
      items,
    };
  } catch {
    return null;
  }
}

export async function getHomeFeedCachePage(after?: string, count = 36) {
  const cache = await readHomeFeedCache();
  if (!cache) {
    return {
      items: [] as FeedItem[],
      nextCursor: undefined as string | undefined,
      hasNextPage: false,
      total: 0,
      source: "empty" as const,
    };
  }

  const pageSize = Math.max(1, Math.min(200, Math.floor(count)));
  const rawOffset = after ? Number(after) : 0;
  const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.floor(rawOffset)) : 0;
  const pageItems = cache.items.slice(offset, offset + pageSize);
  const nextOffset = offset + pageItems.length;
  const hasNextPage = nextOffset < cache.items.length;
  const nextCursor = hasNextPage ? String(nextOffset) : undefined;

  return {
    items: pageItems,
    nextCursor,
    hasNextPage,
    total: cache.items.length,
    source: "cache" as const,
  };
}

export async function getHybridHomeFeedPage(after?: string, count = 36) {
  const cache = await readHomeFeedCache();
  const liveKey = cache?.newestCreatedAt ?? "";
  const now = Date.now();
  const canReuseLive =
    liveMemo &&
    liveMemo.key === liveKey &&
    now - liveMemo.at < LIVE_REFRESH_TTL_MS;

  const fetchLive = async () => {
    const live = await Promise.race<FeedItem[]>([
      getHomeFeedNewerThan(FEED_PROFILES, cache?.newestCreatedAt, 240),
      new Promise<FeedItem[]>((resolve) =>
        setTimeout(() => resolve(liveMemo?.items ?? []), LIVE_FETCH_TIMEOUT_MS)
      ),
    ]);
    liveMemo = { key: liveKey, at: Date.now(), items: live };
    return live;
  };

  const liveItems = canReuseLive
    ? (liveMemo?.items ?? [])
    : await (liveInFlight ??
        (liveInFlight = fetchLive().finally(() => {
          liveInFlight = null;
        })));

  const merged = normalizeItems([...(liveItems ?? []), ...(cache?.items ?? [])]);
  const pageSize = Math.max(1, Math.min(200, Math.floor(count)));
  const rawOffset = after ? Number(after) : 0;
  const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.floor(rawOffset)) : 0;
  const pageItems = merged.slice(offset, offset + pageSize);
  const nextOffset = offset + pageItems.length;
  const hasNextPage = nextOffset < merged.length;
  const nextCursor = hasNextPage ? String(nextOffset) : undefined;

  return {
    items: pageItems,
    nextCursor,
    hasNextPage,
    total: merged.length,
    source: "hybrid" as const,
    liveCount: liveItems.length,
    cacheCount: cache?.items.length ?? 0,
  };
}
