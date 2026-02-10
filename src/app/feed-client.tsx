"use client";

/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FeedItem } from "@/lib/zora-feed";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Props = {
  items: FeedItem[];
};

const MASONRY_GAP_PX = 4; // gap-1

function getColumnCount(containerWidth: number) {
  // 2 cols base, then 3/4/5 at Tailwind sm/lg/2xl breakpoints.
  if (containerWidth >= 1536) return 5;
  if (containerWidth >= 1024) return 4;
  if (containerWidth >= 640) return 3;
  return 2;
}

function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const ro = new ResizeObserver((entries) => {
      const next = Math.floor(entries[0]?.contentRect?.width ?? 0);
      setWidth(next);
    });
    ro.observe(el);
    setWidth(Math.floor(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);

  return { ref, width };
}

function useInfiniteScroll(opts: {
  enabled: boolean;
  getNext: () => void;
  rootMargin?: string;
}) {
  const { enabled, getNext, rootMargin = "800px" } = opts;
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const el = sentinelRef.current;
    if (!el) return;

    const io = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (first?.isIntersecting) getNext();
      },
      { root: null, rootMargin, threshold: 0 }
    );

    io.observe(el);
    return () => io.disconnect();
  }, [enabled, getNext, rootMargin]);

  return { sentinelRef };
}

function MediaTile({
  item,
  index,
  ratio,
  onRatio,
}: {
  item: FeedItem;
  index: number;
  ratio: number; // height / width
  onRatio: (next: number) => void;
}) {
  const [loaded, setLoaded] = useState(false);

  const isVideo =
    !!item.mediaUrl &&
    (item.mediaUrl.endsWith(".mp4") || item.mediaUrl.endsWith(".webm"));

  // Prioritize the first row (up to 3 columns on desktop) to make loading feel ordered.
  const eager = index < 3;

  const safeRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : 4 / 3;
  // ratio is height/width; CSS aspect-ratio expects width/height.
  // If ratio = h/w, then width/height = 1/ratio, which is `1 / (h/w)` => `1 / ratio`.
  // Using `1 / ratio` is equivalent to `1 / safeRatio` => `1 / safeRatio` in CSS form is `1 / safeRatio`.
  const aspectRatio = `${1} / ${safeRatio}`; // width / height

  return (
    <div className="group relative bg-muted">
      <div
        className="relative w-full overflow-hidden"
        // Reserve height even before the image loads; prevents "0px tall" tiles.
        style={{ aspectRatio }}
      >
        {!loaded ? (
          <div className="absolute inset-0 animate-pulse bg-muted" />
        ) : null}

        {item.mediaUrl ? (
          isVideo ? (
            <video
              className={[
                "absolute inset-0 h-full w-full object-contain",
                loaded ? "opacity-100" : "opacity-0",
                "transition-opacity duration-300",
              ].join(" ")}
              src={item.mediaUrl}
              controls
              playsInline
              preload={eager ? "auto" : "metadata"}
              onLoadedMetadata={(e) => {
                setLoaded(true);
                const v = e.currentTarget;
                if (v.videoWidth > 0) onRatio(v.videoHeight / v.videoWidth);
              }}
            />
          ) : (
            <img
              className={[
                "absolute inset-0 h-full w-full object-contain",
                loaded ? "opacity-100" : "opacity-0",
                "transition-opacity duration-300",
              ].join(" ")}
              src={item.mediaUrl}
              alt={item.title}
              width={item.mediaWidth}
              height={item.mediaHeight}
              loading={eager ? "eager" : "lazy"}
              fetchPriority={eager ? "high" : "auto"}
              decoding="async"
              referrerPolicy="no-referrer"
              onLoad={(e) => {
                setLoaded(true);
                const img = e.currentTarget;
                if (img.naturalWidth > 0)
                  onRatio(img.naturalHeight / img.naturalWidth);
              }}
            />
          )
        ) : (
          <div className="absolute inset-0" />
        )}
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-2 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
        <div className="truncate text-xs font-medium text-white">
          {item.creatorHandle ? `@${item.creatorHandle}` : "@"} · {item.title}
        </div>
      </div>
    </div>
  );
}

function TrueMasonry({
  items,
  getRatio,
  onRatio,
}: {
  items: FeedItem[];
  getRatio: (item: FeedItem) => number; // height / width
  onRatio: (id: string, next: number) => void;
}) {
  const { ref, width } = useElementWidth<HTMLDivElement>();

  const layout = useMemo(() => {
    const containerWidth = width;
    if (!containerWidth) {
      return { colWidth: 0, height: 0, pos: [] as Array<{ id: string; x: number; y: number; w: number }> };
    }

    const cols = getColumnCount(containerWidth);
    const colWidth =
      (containerWidth - MASONRY_GAP_PX * (cols - 1)) / cols;

    const colHeights = new Array(cols).fill(0) as number[];
    const pos = items.map((item) => {
      const ratio = getRatio(item);
      const h = Math.max(40, colWidth * ratio);

      let col = 0;
      for (let i = 1; i < cols; i++) {
        if (colHeights[i] < colHeights[col]) col = i;
      }

      const x = col * (colWidth + MASONRY_GAP_PX);
      const y = colHeights[col];
      colHeights[col] = y + h + MASONRY_GAP_PX;

      return { id: item.id, x, y, w: colWidth };
    });

    const height = Math.max(...colHeights, 0) - MASONRY_GAP_PX;
    return { colWidth, height: Math.max(0, height), pos };
  }, [items, width, getRatio]);

  return (
    <div ref={ref} className="w-full px-1">
      <div
        data-masonry
        className="relative"
        style={{ height: layout.height }}
      >
        {items.map((item, idx) => {
          const p = layout.pos[idx];
          return (
            <div
              key={item.id}
              style={{
                position: "absolute",
                width: p?.w ?? undefined,
                transform: `translate3d(${p?.x ?? 0}px,${p?.y ?? 0}px,0)`,
                willChange: "transform",
              }}
            >
              <MediaTile
                item={item}
                index={idx}
                ratio={getRatio(item)}
                onRatio={(next) => onRatio(item.id, next)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function FeedClient({ items }: Props) {
  const [q, setQ] = useState("");
  const [ratios, setRatios] = useState<Record<string, number>>({});

  // This width is used only to decide how many items constitute "3 rows".
  const { ref: contentRef, width: contentWidth } =
    useElementWidth<HTMLDivElement>();

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const base =
      qq.length === 0
        ? items
        : items.filter((it) => {
            return (
              it.title.toLowerCase().includes(qq) ||
              it.description.toLowerCase().includes(qq) ||
              (it.creatorHandle ?? "").toLowerCase().includes(qq)
            );
          });

    const next = [...base];
    next.sort((a, b) => {
      const at = a.createdAt ? Date.parse(a.createdAt) : 0;
      const bt = b.createdAt ? Date.parse(b.createdAt) : 0;
      return bt - at;
    });
    return next;
  }, [items, q]);

  const cols = useMemo(() => {
    if (!contentWidth) return 2;
    return getColumnCount(contentWidth);
  }, [contentWidth]);

  const pageSize = useMemo(() => cols * 3, [cols]);
  const [visibleCount, setVisibleCount] = useState<number>(pageSize);

  // Keep the current progress when resizing, but never show fewer than one page.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisibleCount((prev) => Math.max(pageSize, prev));
  }, [pageSize]);

  useEffect(() => {
    // Reset paging when search changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisibleCount(pageSize);
  }, [q, pageSize]);

  const getRatio = useCallback(
    (item: FeedItem) => {
      const r = ratios[item.id];
      if (typeof r === "number" && Number.isFinite(r) && r > 0) return r;
      if (
        item.mediaWidth &&
        item.mediaHeight &&
        item.mediaWidth > 0 &&
        item.mediaHeight > 0
      ) {
        return item.mediaHeight / item.mediaWidth;
      }
      return 4 / 3;
    },
    [ratios]
  );

  const onRatio = useCallback((id: string, next: number) => {
    if (!Number.isFinite(next) || next <= 0) return;
    setRatios((prev) => (prev[id] === next ? prev : { ...prev, [id]: next }));
  }, []);

  const page = useMemo(
    () => filtered.slice(0, Math.min(filtered.length, visibleCount)),
    [filtered, visibleCount]
  );

  const loadingMoreRef = useRef(false);
  const getNext = useCallback(() => {
    if (loadingMoreRef.current) return;
    if (visibleCount >= filtered.length) return;
    loadingMoreRef.current = true;
    // Batch by 3 rows.
    setVisibleCount((c) => Math.min(filtered.length, c + pageSize));
    // Allow further triggers next tick.
    queueMicrotask(() => {
      loadingMoreRef.current = false;
    });
  }, [filtered.length, pageSize, visibleCount]);

  const { sentinelRef } = useInfiniteScroll({
    enabled: filtered.length > 0 && visibleCount < filtered.length,
    getNext,
    rootMargin: "1200px",
  });

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-xl bg-foreground text-background">
              TS
            </div>
            <nav className="hidden items-center gap-4 text-sm text-muted-foreground sm:flex">
              <a className="text-foreground" href="#">
                Explore
              </a>
              <a href="#">Artistas</a>
              <a href="#">Colecoes</a>
              <a href="#">Drops</a>
            </nav>
          </div>

          <div className="flex flex-1 items-center justify-end gap-3">
            <div className="hidden w-full max-w-md sm:block">
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search (handle, title, description)"
              />
            </div>
            <Button variant="secondary">Connect Wallet</Button>
          </div>
        </div>
      </header>

      {/* Full-bleed content: no max-width here, only the nav is constrained. */}
      <div className="w-full">
        <main className="mt-4">
          {filtered.length === 0 ? (
            <div className="px-3 text-sm text-muted-foreground sm:px-4">
              No items yet. Add profile identifiers in{" "}
              <code className="rounded bg-muted px-1 py-0.5">
                src/lib/profiles.ts
              </code>
              .
            </div>
          ) : (
            <div ref={contentRef}>
              <TrueMasonry items={page} getRatio={getRatio} onRatio={onRatio} />
              <div ref={sentinelRef} className="h-10" />
              <div className="px-3 pb-6 text-xs text-muted-foreground sm:px-4">
                Showing {page.length} / {filtered.length}
              </div>
            </div>
          )}
        </main>

        <footer className="mt-8 border-t px-3 py-8 text-sm text-muted-foreground sm:px-4">
          <div className="flex flex-wrap gap-4">
            <a href="#">Sobre</a>
            <a href="#">Submeter artista</a>
            <a href="#">Termos</a>
            <a href="#">Privacidade</a>
            <a href="#">Contato</a>
            <a href="#">API/Docs</a>
          </div>
        </footer>
      </div>
    </div>
  );
}
