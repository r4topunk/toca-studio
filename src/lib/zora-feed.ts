import { getProfileCoins } from "@zoralabs/coins-sdk";
import { cache } from "react";
import probe from "probe-image-size";

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

async function probeImageDimensions(url: string): Promise<
  | {
      width: number;
      height: number;
    }
  | undefined
> {
  // Avoid downloading the whole file; a small prefix is enough for JPEG/PNG/WebP/GIF headers.
  const res = await fetch(url, {
    headers: { range: "bytes=0-65535" },
    next: { revalidate: 60 * 60 * 24 },
  });
  if (!res.ok) return undefined;

  const buf = Buffer.from(await res.arrayBuffer());
  const r = probe.sync(buf);
  if (!r || !Number.isFinite(r.width) || !Number.isFinite(r.height))
    return undefined;
  return { width: r.width, height: r.height };
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
      let mediaMimeType: string | undefined;
      let mediaWidth: number | undefined;
      let mediaHeight: number | undefined;

      const mc = coin.mediaContent as
        | {
            mimeType?: string;
            originalUri?: string;
            previewImage?: { medium?: string; small?: string };
          }
        | undefined;

      if (mc?.mimeType) mediaMimeType = mc.mimeType;

      if (mc?.mimeType?.startsWith("image/")) {
        mediaUrl = mc.previewImage?.medium ?? mc.previewImage?.small;
        if (!mediaUrl && mc.originalUri) mediaUrl = toHttpUrl(mc.originalUri);
      } else if (mc?.mimeType?.startsWith("video/")) {
        if (mc.originalUri) mediaUrl = toHttpUrl(mc.originalUri);
      } else {
        // Fallback: try tokenUri metadata if mediaContent isn't helpful.
        if (tokenUri) {
          try {
            const res = await fetch(tokenUri, { next: { revalidate: 60 } });
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
              const candidate = animationUrl ?? image;
              if (candidate) mediaUrl = toHttpUrl(candidate);
            }
          } catch {
            // Ignore.
          }
        }
      }

      if (mediaUrl && (mediaMimeType?.startsWith("image/") ?? true)) {
        const dims = await probeImageDimensions(mediaUrl).catch(() => undefined);
        mediaWidth = dims?.width;
        mediaHeight = dims?.height;
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
        mediaMimeType,
        mediaWidth,
        mediaHeight,
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
