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
