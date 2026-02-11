import { promises as fs } from "node:fs";
import path from "node:path";
import { getProfileCoins } from "@zoralabs/coins-sdk";
import { FEED_PROFILES } from "../src/lib/profiles.ts";

const OUT_PATH = path.join(process.cwd(), "data", "home-feed-cache.json");
const PROGRESS_PATH = path.join(process.cwd(), "data", "home-feed-cache.progress.json");
const TARGET = Number(process.env.TARGET || "3333");
const PAGE_SIZE = Math.max(1, Math.min(50, Number(process.env.PAGE_SIZE || "50")));
const MODE = (process.env.MODE || "full").toLowerCase(); // full | incremental
const CONCURRENCY = Math.max(1, Math.min(6, Number(process.env.CONCURRENCY || "3")));
const WRITE_PROGRESS_JSON = process.env.PROGRESS_JSON === "1";

function toHttpUrl(uri) {
  if (typeof uri !== "string") return undefined;
  if (uri.startsWith("ipfs://")) return `https://ipfs.io/ipfs/${uri.slice("ipfs://".length)}`;
  if (uri.startsWith("ar://")) return `https://arweave.net/${uri.slice("ar://".length)}`;
  return uri;
}

const withTimeout = async (p, ms) =>
  await Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms)),
  ]);

async function getProfileCoinsWithRetry(identifier, after, count) {
  const attempts = 3;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      const res = await withTimeout(
        getProfileCoins({ identifier, after, count }),
        9000
      );
      if ("error" in res && res.error) {
        if (i === attempts) return null;
      } else {
        return res;
      }
    } catch {
      if (i === attempts) return null;
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * i));
  }
  return null;
}

async function mapCoinToItem(coin) {
  const tokenUri = coin?.tokenUri ? toHttpUrl(coin.tokenUri) : undefined;
  let mediaUrl;
  let mediaPreviewUrl;
  let mediaMimeType;
  let mediaWidth;
  let mediaHeight;

  const mc = coin?.mediaContent;
  if (mc?.mimeType) mediaMimeType = mc.mimeType;

  if (mc?.mimeType?.startsWith("image/")) {
    mediaPreviewUrl = mc?.previewImage?.medium ?? mc?.previewImage?.small;
    mediaUrl = mediaPreviewUrl || (mc?.originalUri ? toHttpUrl(mc.originalUri) : undefined);
  } else if (mc?.mimeType?.startsWith("video/")) {
    mediaPreviewUrl = mc?.previewImage?.medium ?? mc?.previewImage?.small;
    mediaUrl = mc?.originalUri ? toHttpUrl(mc.originalUri) : undefined;
  } else if (tokenUri) {
    try {
      const meta = await withTimeout(fetch(tokenUri, { cache: "no-store" }), 2500);
      if (meta.ok) {
        const obj = await meta.json();
        const image = typeof obj?.image === "string" ? obj.image : undefined;
        const animation = typeof obj?.animation_url === "string" ? obj.animation_url : undefined;
        mediaPreviewUrl = image ? toHttpUrl(image) : undefined;
        mediaUrl = (animation || image) ? toHttpUrl(animation || image) : undefined;
      }
    } catch {
      // ignore metadata fallback failure
    }
  }

  if (coin?.mediaContent?.original?.width) mediaWidth = coin.mediaContent.original.width;
  if (coin?.mediaContent?.original?.height) mediaHeight = coin.mediaContent.original.height;

  return {
    id: coin.id,
    coinAddress: coin.address,
    chainId: coin.chainId,
    createdAt: coin.createdAt,
    title: coin.name || "Untitled",
    description: coin.description || "",
    symbol: coin.symbol || "",
    creatorHandle: coin?.creatorProfile?.handle,
    creatorAvatarUrl: coin?.creatorProfile?.avatar?.previewImage?.small,
    tokenUri,
    mediaUrl,
    mediaPreviewUrl,
    mediaMimeType,
    mediaWidth,
    mediaHeight,
  };
}

function sortByDateDesc(items) {
  items.sort((a, b) => {
    const at = a.createdAt ? Date.parse(a.createdAt) : 0;
    const bt = b.createdAt ? Date.parse(b.createdAt) : 0;
    return bt - at;
  });
  return items;
}

async function readExisting() {
  try {
    const raw = await fs.readFile(OUT_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    return { ...parsed, items: sortByDateDesc(items) };
  } catch {
    return null;
  }
}

async function build() {
  const startedAt = Date.now();
  const existing = await readExisting();
  const isIncremental = MODE === "incremental";
  const cutoff = isIncremental ? existing?.items?.[0]?.createdAt : undefined;
  const byId = new Map(
    (isIncremental && Array.isArray(existing?.items) ? existing.items : []).map((x) => [x.id, x])
  );

  const states = new Map(
    FEED_PROFILES.map((identifier) => [
      identifier,
      { after: undefined, hasNext: true, stopByCutoff: false },
    ])
  );

  let rounds = 0;
  const maxRounds = Math.max(30, Math.ceil(TARGET / PAGE_SIZE) * 8);

  async function writeProgress(extra = {}) {
    if (!WRITE_PROGRESS_JSON) return;
    await fs.mkdir(path.dirname(PROGRESS_PATH), { recursive: true });
    await fs.writeFile(
      PROGRESS_PATH,
      JSON.stringify(
        {
          status: "running",
          mode: isIncremental ? "incremental" : "full",
          target: TARGET,
          pageSize: PAGE_SIZE,
          concurrency: CONCURRENCY,
          profiles: FEED_PROFILES.length,
          rounds,
          maxRounds,
          totalCollected: byId.size,
          cutoff: cutoff ?? null,
          startedAt: new Date(startedAt).toISOString(),
          updatedAt: new Date().toISOString(),
          elapsedMs: Date.now() - startedAt,
          out: OUT_PATH,
          ...extra,
        },
        null,
        2
      ),
      "utf8"
    );
  }

  await writeProgress({ phase: "starting" });
  console.log(
    `[cache] start mode=${isIncremental ? "incremental" : "full"} target=${TARGET} pageSize=${PAGE_SIZE} concurrency=${CONCURRENCY} profiles=${FEED_PROFILES.length}`
  );
  if (cutoff) console.log(`[cache] cutoff=${cutoff}`);

  while (rounds < maxRounds) {
    rounds += 1;
    const active = FEED_PROFILES.filter((id) => {
      const s = states.get(id);
      return Boolean(s?.hasNext && !s?.stopByCutoff);
    });
    if (active.length === 0) break;
    if (!isIncremental && byId.size >= TARGET) break;
    await writeProgress({ phase: "round", activeProfiles: active.length });
    console.log(
      `[cache] round ${rounds}/${maxRounds} activeProfiles=${active.length} collected=${byId.size}`
    );

    for (let i = 0; i < active.length; i += CONCURRENCY) {
      const chunk = active.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        chunk.map(async (identifier) => {
          const state = states.get(identifier);
          const res = await getProfileCoinsWithRetry(
            identifier,
            state?.after,
            PAGE_SIZE
          );
          return { identifier, state, res };
        })
      );

      for (const { identifier, state, res } of results) {
        if (!state) continue;
        if (!res) {
          state.hasNext = false;
          states.set(identifier, state);
          await writeProgress({ phase: "profile-error", profile: identifier });
          console.log(`[cache] profile error identifier=${identifier}`);
          continue;
        }

        const data = "data" in res ? res.data : undefined;
        const created = data?.profile?.createdCoins;
        const coins = created?.edges?.map((e) => e.node) ?? [];
        let reachedCutoff = false;
        let insertedThisPage = 0;

        for (const coin of coins) {
          const createdAt = coin?.createdAt;
          if (
            cutoff &&
            createdAt &&
            Date.parse(createdAt) <= Date.parse(cutoff)
          ) {
            reachedCutoff = true;
            break;
          }
          if (!coin?.id || byId.has(coin.id)) continue;
          byId.set(coin.id, await mapCoinToItem(coin));
          insertedThisPage += 1;
          if (!isIncremental && byId.size >= TARGET) break;
        }

        const endCursor = created?.pageInfo?.endCursor;
        const hasNextPage = Boolean(created?.pageInfo?.hasNextPage && endCursor);
        state.after = endCursor;
        state.hasNext = hasNextPage;
        state.stopByCutoff = Boolean(reachedCutoff);
        states.set(identifier, state);
        console.log(
          `[cache] profile=${identifier} inserted=${insertedThisPage} hasNext=${hasNextPage} stopByCutoff=${Boolean(
            reachedCutoff
          )} total=${byId.size}`
        );

        if (!isIncremental && byId.size >= TARGET) break;

        if (insertedThisPage === 0 && !hasNextPage) {
          state.hasNext = false;
          states.set(identifier, state);
        }
      }

      if (!isIncremental && byId.size >= TARGET) break;
      await writeProgress({ phase: "chunk-complete", activeProfiles: active.length });
      console.log(`[cache] chunk done collected=${byId.size}`);
    }
  }

  const items = sortByDateDesc(Array.from(byId.values()));
  const trimmed = isIncremental ? items : items.slice(0, TARGET);
  const newestCreatedAt = trimmed[0]?.createdAt;
  const oldestCreatedAt = trimmed[trimmed.length - 1]?.createdAt;

  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(
    OUT_PATH,
    JSON.stringify(
      {
        version: 1,
        generatedAt: new Date().toISOString(),
        profiles: FEED_PROFILES,
        mode: isIncremental ? "incremental" : "full",
        newestCreatedAt,
        oldestCreatedAt,
        total: trimmed.length,
        items: trimmed,
      },
      null,
      2
    ),
    "utf8"
  );

  await fs.writeFile(
    PROGRESS_PATH,
    JSON.stringify(
      {
        status: "done",
        mode: isIncremental ? "incremental" : "full",
        target: TARGET,
        pageSize: PAGE_SIZE,
        concurrency: CONCURRENCY,
        profiles: FEED_PROFILES.length,
        rounds,
        totalCollected: trimmed.length,
        newestCreatedAt,
        oldestCreatedAt,
        startedAt: new Date(startedAt).toISOString(),
        finishedAt: new Date().toISOString(),
        elapsedMs: Date.now() - startedAt,
        out: OUT_PATH,
      },
      null,
      2
    ),
    "utf8"
  );
  console.log(
    `[cache] done total=${trimmed.length} newest=${newestCreatedAt ?? "n/a"} oldest=${oldestCreatedAt ?? "n/a"} elapsedMs=${Date.now() - startedAt}`
  );

  console.log(
    JSON.stringify({
      out: OUT_PATH,
      mode: isIncremental ? "incremental" : "full",
      total: trimmed.length,
      newestCreatedAt,
      oldestCreatedAt,
      target: TARGET,
      profiles: FEED_PROFILES.length,
      rounds,
    })
  );
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
