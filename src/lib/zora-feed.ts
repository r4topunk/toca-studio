import { getProfileCoins } from "@zoralabs/coins-sdk";
import { cache } from "react";

export type FeedItem = {
  id: string;
  coinAddress: string;
  chainId: number;
  createdAt?: string;

  title: string;
  description: string;
  symbol: string;

  creatorHandle?: string;
  creatorAvatarUrl?: string;

  tokenUri?: string;
  mediaUrl?: string;
  mediaPreviewUrl?: string;
  mediaMimeType?: string;
  mediaWidth?: number;
  mediaHeight?: number;
};

function toHttpUrl(uri: string): string {
  if (uri.startsWith("ipfs://")) {
    return `https://ipfs.io/ipfs/${uri.slice("ipfs://".length)}`;
  }
  if (uri.startsWith("ar://")) {
    return `https://arweave.net/${uri.slice("ar://".length)}`;
  }
  return uri;
}

export const getHomeFeed = cache(async (identifiers: string[]) => {
  const withTimeout = async <T,>(p: Promise<T>, ms: number) => {
    return await Promise.race([
      p,
      new Promise<T>((_, rej) =>
        setTimeout(() => rej(new Error("timeout")), ms)
      ),
    ]);
  };

  const results = await Promise.all(
    identifiers.map(async (identifier) => {
      try {
        const r = await withTimeout(getProfileCoins({ identifier, count: 12 }), 4000);
        const err = "error" in r ? r.error : undefined;
        if (err) return [];
        const data = "data" in r ? r.data : undefined;
        return data?.profile?.createdCoins?.edges?.map((e) => e.node) ?? [];
      } catch {
        // Keep the home page resilient even if Zora rate-limits / times out for some profiles.
        return [];
      }
    })
  );

  const coins = results.flat();

  const items = await Promise.all(
    coins.map(async (coin) => {
      const tokenUri = coin.tokenUri ? toHttpUrl(coin.tokenUri) : undefined;

      let mediaUrl: string | undefined;
      let mediaPreviewUrl: string | undefined;
      let mediaMimeType: string | undefined;

      const mc = coin.mediaContent as
        | {
            mimeType?: string;
            originalUri?: string;
            previewImage?: { medium?: string; small?: string };
          }
        | undefined;

      if (mc?.mimeType) mediaMimeType = mc.mimeType;

      if (mc?.mimeType?.startsWith("image/")) {
        mediaPreviewUrl = mc.previewImage?.medium ?? mc.previewImage?.small;
        mediaUrl = mediaPreviewUrl;
        if (!mediaUrl && mc.originalUri) mediaUrl = toHttpUrl(mc.originalUri);
      } else if (mc?.mimeType?.startsWith("video/")) {
        mediaPreviewUrl = mc.previewImage?.medium ?? mc.previewImage?.small;
        if (mc.originalUri) mediaUrl = toHttpUrl(mc.originalUri);
      } else {
        // Fallback: try tokenUri metadata if mediaContent isn't helpful.
        if (tokenUri) {
          try {
            const res = await withTimeout(
              fetch(tokenUri, { next: { revalidate: 60 } }),
              1200
            );
            if (res.ok) {
              const json: unknown = await res.json();
              const obj =
                json && typeof json === "object"
                  ? (json as Record<string, unknown>)
                  : {};
              const image = typeof obj.image === "string" ? obj.image : undefined;
              const animationUrl =
                typeof obj.animation_url === "string"
                  ? obj.animation_url
                  : undefined;
              mediaPreviewUrl = image ? toHttpUrl(image) : undefined;
              const candidate = animationUrl ?? image;
              if (candidate) mediaUrl = toHttpUrl(candidate);
            }
          } catch {
            // Ignore.
          }
        }
      }

      return {
        id: coin.id,
        coinAddress: coin.address,
        chainId: coin.chainId,
        createdAt: coin.createdAt,
        title: coin.name,
        description: coin.description,
        symbol: coin.symbol,
        creatorHandle: coin.creatorProfile?.handle,
        creatorAvatarUrl: coin.creatorProfile?.avatar?.previewImage?.small,
        tokenUri,
        mediaUrl,
        mediaPreviewUrl,
        mediaMimeType,
      } satisfies FeedItem;
    })
  );

  items.sort((a, b) => {
    const at = a.createdAt ? Date.parse(a.createdAt) : 0;
    const bt = b.createdAt ? Date.parse(b.createdAt) : 0;
    return bt - at;
  });

  return items.slice(0, 120);
});

type HomeFeedState = {
  after?: string;
  hasNext: boolean;
  consecutiveFailures: number;
};

const collectHomeItems = async (
  identifiers: string[],
  targetCount: number,
  batchSize = 12
) => {
  const getProfilePageWithRetry = async (
    identifier: string,
    after: string | undefined,
    count: number
  ) => {
    const attempts = 3;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const r = await withTimeout(
          getProfileCoins({ identifier, count, after }),
          6500
        );
        if ("error" in r && r.error) {
          if (attempt === attempts) return null;
        } else {
          return r;
        }
      } catch {
        if (attempt === attempts) return null;
      }
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
    return null;
  };

  const states = new Map<string, HomeFeedState>(
    identifiers.map((identifier) => [
      identifier,
      { after: undefined, hasNext: true, consecutiveFailures: 0 },
    ])
  );
  const byId = new Map<string, FeedItem>();

  let rounds = 0;
  const safeBatch = Math.max(1, Math.min(50, Math.floor(batchSize)));
  const maxRounds = Math.max(30, Math.ceil(targetCount / safeBatch) * 6);
  const concurrency = 4;

  while (byId.size < targetCount && rounds < maxRounds) {
    rounds += 1;
    const active = identifiers.filter((identifier) => states.get(identifier)?.hasNext);
    if (active.length === 0) break;

    const responses: Array<{ identifier: string; result: Awaited<ReturnType<typeof getProfilePageWithRetry>> }> = [];
    for (let i = 0; i < active.length; i += concurrency) {
      const chunk = active.slice(i, i + concurrency);
      const chunkResponses = await Promise.all(
        chunk.map(async (identifier) => {
          const state = states.get(identifier);
          const r = await getProfilePageWithRetry(
            identifier,
            state?.after,
            safeBatch
          );
          return { identifier, result: r };
        })
      );
      responses.push(...chunkResponses);
    }

    for (const entry of responses) {
      const state = states.get(entry.identifier);
      if (!state) continue;

      const r = entry.result;
      if (!r || ("error" in r && r.error)) {
        state.consecutiveFailures += 1;
        // Stop trying this profile in this request after repeated failures.
        if (state.consecutiveFailures >= 3) state.hasNext = false;
        states.set(entry.identifier, state);
        continue;
      }
      state.consecutiveFailures = 0;

      const data = "data" in r ? r.data : undefined;
      const created = data?.profile?.createdCoins;
      const coins = created?.edges?.map((e) => e.node) ?? [];
      const unseen = coins.filter((coin) => !byId.has(coin.id));
      if (unseen.length > 0) {
        const mapped = await Promise.all(unseen.map(mapCoinToItem));
        for (const item of mapped) byId.set(item.id, item);
      }

      const endCursor = created?.pageInfo?.endCursor;
      const hasNextPage = Boolean(created?.pageInfo?.hasNextPage && endCursor);
      state.after = endCursor;
      state.hasNext = hasNextPage;
      states.set(entry.identifier, state);
    }
  }

  const items = Array.from(byId.values());
  items.sort((a, b) => {
    const at = a.createdAt ? Date.parse(a.createdAt) : 0;
    const bt = b.createdAt ? Date.parse(b.createdAt) : 0;
    return bt - at;
  });

  const hasAnyProfileWithNext = identifiers.some(
    (identifier) => states.get(identifier)?.hasNext
  );

  return { items, hasAnyProfileWithNext };
};

export const getHomeFeedPage = cache(
  async (identifiers: string[], after?: string, count = 36) => {
    const pageSize = Math.max(1, Math.min(80, Math.floor(count)));
    const rawOffset = after ? Number(after) : 0;
    const offset = Number.isFinite(rawOffset)
      ? Math.max(0, Math.floor(rawOffset))
      : 0;
    const needed = offset + pageSize + 1;
    const perProfileBatch = Math.max(6, Math.ceil((pageSize * 2) / Math.max(1, identifiers.length)));

    const { items, hasAnyProfileWithNext } = await collectHomeItems(
      identifiers,
      needed,
      perProfileBatch
    );

    const pageItems = items.slice(offset, offset + pageSize);
    const advancedCursor = offset + pageItems.length;
    const hasAdvanced = advancedCursor > offset;
    const hasNextPage =
      hasAdvanced && (items.length > offset + pageSize || hasAnyProfileWithNext);
    const nextCursor = hasNextPage ? String(advancedCursor) : undefined;

    return { items: pageItems, nextCursor, hasNextPage };
  }
);

export async function getHomeFeedNewerThan(
  identifiers: string[],
  newerThan?: string,
  maxItems = 240
) {
  if (!newerThan || identifiers.length === 0 || maxItems <= 0) {
    return [] as FeedItem[];
  }

  const cutoff = Date.parse(newerThan);
  if (!Number.isFinite(cutoff)) return [] as FeedItem[];

  const byId = new Map<string, FeedItem>();
  const states = new Map(
    identifiers.map((identifier) => [
      identifier,
      { after: undefined as string | undefined, hasNext: true, reachedCutoff: false },
    ])
  );

  const pageSize = 20;
  const maxRounds = 6;
  const concurrency = 4;

  const fetchProfilePageWithRetry = async (
    identifier: string,
    after: string | undefined
  ) => {
    const attempts = 3;
    for (let i = 1; i <= attempts; i += 1) {
      try {
        const r = await withTimeout(
          getProfileCoins({ identifier, count: pageSize, after }),
          6500
        );
        if ("error" in r && r.error) {
          if (i === attempts) return null;
        } else {
          return r;
        }
      } catch {
        if (i === attempts) return null;
      }
      await new Promise((resolve) => setTimeout(resolve, 200 * i));
    }
    return null;
  };

  for (let round = 0; round < maxRounds; round += 1) {
    if (byId.size >= maxItems) break;
    const active = identifiers.filter((identifier) => {
      const s = states.get(identifier);
      return Boolean(s?.hasNext && !s?.reachedCutoff);
    });
    if (active.length === 0) break;

    for (let i = 0; i < active.length; i += concurrency) {
      const chunk = active.slice(i, i + concurrency);
      const responses = await Promise.all(
        chunk.map(async (identifier) => {
          const state = states.get(identifier);
          const r = await fetchProfilePageWithRetry(identifier, state?.after);
          return { identifier, r };
        })
      );

      for (const { identifier, r } of responses) {
        const state = states.get(identifier);
        if (!state) continue;

        if (!r || ("error" in r && r.error)) {
          state.hasNext = false;
          states.set(identifier, state);
          continue;
        }

        const data = "data" in r ? r.data : undefined;
        const created = data?.profile?.createdCoins;
        const coins = created?.edges?.map((e) => e.node) ?? [];

        for (const coin of coins) {
          const createdAt = coin?.createdAt;
          const createdTs = createdAt ? Date.parse(createdAt) : NaN;
          if (Number.isFinite(createdTs) && createdTs <= cutoff) {
            state.reachedCutoff = true;
            break;
          }
          if (!coin?.id || byId.has(coin.id)) continue;
          byId.set(coin.id, await mapCoinToItem(coin));
          if (byId.size >= maxItems) break;
        }

        const endCursor = created?.pageInfo?.endCursor;
        const hasNextPage = Boolean(created?.pageInfo?.hasNextPage && endCursor);
        state.after = endCursor;
        state.hasNext = hasNextPage;
        states.set(identifier, state);
      }
    }
  }

  const items = Array.from(byId.values());
  items.sort((a, b) => {
    const at = a.createdAt ? Date.parse(a.createdAt) : 0;
    const bt = b.createdAt ? Date.parse(b.createdAt) : 0;
    return bt - at;
  });
  return items.slice(0, maxItems);
}

export type ArtistProfile = {
  handle: string;
  avatarUrl?: string;
  social?: {
    twitter?: string;
    instagram?: string;
    farcaster?: string;
    tiktok?: string;
  };
};

const withTimeout = async <T,>(p: Promise<T>, ms: number) => {
  return await Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms)),
  ]);
};

const mapCoinToItem = async (coin: {
  id: string;
  address: string;
  chainId: number;
  createdAt?: string;
  name: string;
  description: string;
  symbol: string;
  tokenUri?: string;
  creatorProfile?: {
    handle?: string;
    avatar?: { previewImage?: { small?: string } };
  };
  mediaContent?: unknown;
}) => {
  const tokenUri = coin.tokenUri ? toHttpUrl(coin.tokenUri) : undefined;

  let mediaUrl: string | undefined;
  let mediaPreviewUrl: string | undefined;
  let mediaMimeType: string | undefined;

  const mc = coin.mediaContent as
    | {
        mimeType?: string;
        originalUri?: string;
        previewImage?: { medium?: string; small?: string };
      }
    | undefined;

  if (mc?.mimeType) mediaMimeType = mc.mimeType;

  if (mc?.mimeType?.startsWith("image/")) {
    mediaPreviewUrl = mc.previewImage?.medium ?? mc.previewImage?.small;
    mediaUrl = mediaPreviewUrl;
    if (!mediaUrl && mc.originalUri) mediaUrl = toHttpUrl(mc.originalUri);
  } else if (mc?.mimeType?.startsWith("video/")) {
    mediaPreviewUrl = mc.previewImage?.medium ?? mc.previewImage?.small;
    if (mc.originalUri) mediaUrl = toHttpUrl(mc.originalUri);
  } else if (tokenUri) {
    try {
      const res = await withTimeout(fetch(tokenUri, { next: { revalidate: 60 } }), 1200);
      if (res.ok) {
        const json: unknown = await res.json();
        const obj =
          json && typeof json === "object" ? (json as Record<string, unknown>) : {};
        const image = typeof obj.image === "string" ? obj.image : undefined;
        const animationUrl =
          typeof obj.animation_url === "string" ? obj.animation_url : undefined;
        mediaPreviewUrl = image ? toHttpUrl(image) : undefined;
        const candidate = animationUrl ?? image;
        if (candidate) mediaUrl = toHttpUrl(candidate);
      }
    } catch {
      // Ignore.
    }
  }

  return {
    id: coin.id,
    coinAddress: coin.address,
    chainId: coin.chainId,
    createdAt: coin.createdAt,
    title: coin.name,
    description: coin.description,
    symbol: coin.symbol,
    creatorHandle: coin.creatorProfile?.handle,
    creatorAvatarUrl: coin.creatorProfile?.avatar?.previewImage?.small,
    tokenUri,
    mediaUrl,
    mediaPreviewUrl,
    mediaMimeType,
  } satisfies FeedItem;
};

export const getArtistFeedPage = cache(
  async (rawHandle: string, after?: string, count = 18) => {
    const handle = rawHandle.replace(/^@+/, "");
    let failed = false;
    let profile: ArtistProfile | null = null;
    let items: FeedItem[] = [];
    let nextCursor: string | undefined;
    let hasNextPage = false;

    try {
      const r = await withTimeout(
        getProfileCoins({ identifier: handle, count, after }),
        5000
      );
      const err = "error" in r ? r.error : undefined;
      if (err) {
        failed = true;
      } else {
        const data = "data" in r ? r.data : undefined;
        const p = data?.profile;
        if (p?.handle) {
          profile = {
            handle: p.handle,
            avatarUrl: p.avatar?.previewImage?.small ?? undefined,
            social: {
              twitter: p.socialAccounts?.twitter?.username,
              instagram: p.socialAccounts?.instagram?.username,
              farcaster: p.socialAccounts?.farcaster?.username,
              tiktok: p.socialAccounts?.tiktok?.username,
            },
          } satisfies ArtistProfile;
        }

        const created = p?.createdCoins;
        const coins = created?.edges?.map((e) => e.node) ?? [];
        items = await Promise.all(coins.map(mapCoinToItem));
        items.sort((a, b) => {
          const at = a.createdAt ? Date.parse(a.createdAt) : 0;
          const bt = b.createdAt ? Date.parse(b.createdAt) : 0;
          return bt - at;
        });

        nextCursor = created?.pageInfo?.endCursor;
        hasNextPage = Boolean(created?.pageInfo?.hasNextPage && nextCursor);
      }
    } catch {
      failed = true;
    }

    return { profile, items, failed, nextCursor, hasNextPage };
  }
);
