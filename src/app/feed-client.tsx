"use client"

/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import Link from "next/link"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { FeedItem } from "@/lib/zora-feed"

type Props = {
  items: FeedItem[]
  topSlot?: ReactNode
  showFooter?: boolean
  showColumnsControl?: boolean
  columnsTitle?: string
  columnsStorageKey?: string
  pageSize?: number
  remotePagination?: {
    endpoint: string
    initialCursor?: string
    initialHasNextPage: boolean
    count: number
  }
}

const MASONRY_GAP_PX = 4 // gap-1
const FEED_DEBUG = process.env.NEXT_PUBLIC_FEED_DEBUG === "1"

function logFeedDebug(message: string, data?: Record<string, unknown>) {
  if (!FEED_DEBUG) return
  const now = new Date().toISOString()
  if (data) {
    console.log(`[feed-client ${now}] ${message}`, data)
    return
  }
  console.log(`[feed-client ${now}] ${message}`)
}

function getColumnCount(containerWidth: number, forced?: number) {
  if (typeof forced === "number" && forced > 0) return forced
  // 2 cols base, then 3/4/5 at Tailwind sm/lg/2xl breakpoints.
  if (containerWidth >= 1536) return 5
  if (containerWidth >= 1024) return 4
  if (containerWidth >= 640) return 3
  return 2
}

function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const ro = new ResizeObserver((entries) => {
      const next = Math.floor(entries[0]?.contentRect?.width ?? 0)
      setWidth(next)
    })
    ro.observe(el)
    setWidth(Math.floor(el.getBoundingClientRect().width))
    return () => ro.disconnect()
  }, [])

  return { ref, width }
}

function useInfiniteScroll(opts: {
  enabled: boolean
  getNext: () => void
  rootMargin?: string
}) {
  const { enabled, getNext, rootMargin = "800px" } = opts
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!enabled) return
    const el = sentinelRef.current
    if (!el) return

    const io = new IntersectionObserver(
      (entries) => {
        const first = entries[0]
        if (first?.isIntersecting) {
          logFeedDebug("sentinel intersected", {
            rootMargin,
            intersectionRatio: first.intersectionRatio,
          })
          getNext()
        }
      },
      { root: null, rootMargin, threshold: 0 }
    )

    io.observe(el)
    return () => io.disconnect()
  }, [enabled, getNext, rootMargin])

  return { sentinelRef }
}

function MediaTile({
  item,
  index,
  ratio,
  onRatio,
  onOpen,
}: {
  item: FeedItem
  index: number
  ratio: number // height / width
  onRatio: (next: number) => void
  onOpen: (item: FeedItem) => void
}) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const displayUrl = item.mediaPreviewUrl ?? item.mediaUrl

  const bindImgRef = useCallback(
    (img: HTMLImageElement | null) => {
      // If the image finished loading before React hydration/event binding,
      // onLoad may not fire and the tile can stay in skeleton state forever.
      if (!img || !img.complete) return

      if (img.naturalWidth > 0) {
        setLoaded(true)
        onRatio(img.naturalHeight / img.naturalWidth)
      } else {
        setFailed(true)
        setLoaded(true)
      }
    },
    [onRatio]
  )

  // Prioritize the first row (up to 3 columns on desktop) to make loading feel ordered.
  const eager = index < 3

  const safeRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : 4 / 3
  const aspectRatio = `${1} / ${safeRatio}` // width / height

  return (
    <button
      type="button"
      className="group relative w-full cursor-pointer bg-muted text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => onOpen(item)}
      aria-label={`Abrir detalhes de ${item.title}`}
    >
      <div
        className="relative w-full overflow-hidden"
        style={{ aspectRatio }}
      >
        {!loaded && !failed ? (
          <div className="absolute inset-0 animate-pulse bg-muted" />
        ) : null}

        {displayUrl ? (
          <img
            ref={bindImgRef}
            className={[
              "absolute inset-0 h-full w-full object-contain",
              loaded ? "opacity-100" : "opacity-0",
              "transition-opacity duration-300",
            ].join(" ")}
            src={displayUrl}
            alt={item.title}
            width={item.mediaWidth}
            height={item.mediaHeight}
            loading={eager ? "eager" : "lazy"}
            fetchPriority={eager ? "high" : "auto"}
            decoding="async"
            referrerPolicy="no-referrer"
            onLoad={(e) => {
              setLoaded(true)
              const img = e.currentTarget
              if (img.naturalWidth > 0)
                onRatio(img.naturalHeight / img.naturalWidth)
            }}
            onError={() => {
              setFailed(true)
              setLoaded(true)
            }}
          />
        ) : (
          <div className="absolute inset-0" />
        )}
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-2 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
        <div className="truncate text-xs font-medium text-white">
          {item.creatorHandle ? `@${item.creatorHandle}` : "@"} · {item.title}
        </div>
      </div>
    </button>
  )
}

function TrueMasonry({
  items,
  getRatio,
  onRatio,
  onOpen,
  forcedCols,
}: {
  items: FeedItem[]
  getRatio: (item: FeedItem) => number // height / width
  onRatio: (id: string, next: number) => void
  onOpen: (item: FeedItem) => void
  forcedCols?: number
}) {
  const { ref, width } = useElementWidth<HTMLDivElement>()

  const layout = useMemo(() => {
    const containerWidth = width
    if (!containerWidth) {
      return {
        colWidth: 0,
        height: 0,
        pos: [] as Array<{ id: string; x: number; y: number; w: number }>,
      }
    }

    const cols = getColumnCount(containerWidth, forcedCols)
    const colWidth = (containerWidth - MASONRY_GAP_PX * (cols - 1)) / cols

    const colHeights = new Array(cols).fill(0) as number[]
    const pos = items.map((item) => {
      const ratio = getRatio(item)
      const h = Math.max(40, colWidth * ratio)

      let col = 0
      for (let i = 1; i < cols; i++) {
        if (colHeights[i] < colHeights[col]) col = i
      }

      const x = col * (colWidth + MASONRY_GAP_PX)
      const y = colHeights[col]
      colHeights[col] = y + h + MASONRY_GAP_PX

      return { id: item.id, x, y, w: colWidth }
    })

    const height = Math.max(...colHeights, 0) - MASONRY_GAP_PX
    return { colWidth, height: Math.max(0, height), pos }
  }, [forcedCols, items, width, getRatio])

  return (
    <div ref={ref} className="w-full px-1">
      <div data-masonry className="relative" style={{ height: layout.height }}>
        {items.map((item, idx) => {
          const p = layout.pos[idx]
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
                onOpen={onOpen}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function getZoraUrl(item: FeedItem) {
  const chainNameById: Record<number, string> = {
    1: "ethereum",
    8453: "base",
  }
  const chain = chainNameById[item.chainId] ?? String(item.chainId)
  return `https://zora.co/coin/${chain}:${item.coinAddress}`
}

function formatCreatedAt(createdAt?: string) {
  if (!createdAt) return null
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) return null

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}

export function FeedClient({
  items,
  topSlot,
  showFooter = true,
  showColumnsControl = false,
  columnsTitle = "Selected Works",
  columnsStorageKey = "toca:columns:default",
  pageSize: fixedPageSize,
  remotePagination,
}: Props) {
  const [loadedItems, setLoadedItems] = useState<FeedItem[]>(items)
  const [nextCursor, setNextCursor] = useState<string | undefined>(
    remotePagination?.initialCursor
  )
  const [hasRemoteMore, setHasRemoteMore] = useState(
    remotePagination?.initialHasNextPage ?? false
  )
  const [remoteLoading, setRemoteLoading] = useState(false)
  const [ratios, setRatios] = useState<Record<string, number>>({})
  const [selectedItem, setSelectedItem] = useState<FeedItem | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [columnCount, setColumnCount] = useState(3)
  const [columnsLoaded, setColumnsLoaded] = useState(false)

  // This width is used only to decide how many items constitute "3 rows".
  const { ref: contentRef, width: contentWidth } = useElementWidth<HTMLDivElement>()

  const filtered = useMemo(() => {
    const source = remotePagination ? loadedItems : items
    const next = [...source]
    next.sort((a, b) => {
      const at = a.createdAt ? Date.parse(a.createdAt) : 0
      const bt = b.createdAt ? Date.parse(b.createdAt) : 0
      return bt - at
    })
    return next
  }, [items, loadedItems, remotePagination])

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)")
    const sync = () => setIsMobile(mq.matches)
    sync()
    mq.addEventListener("change", sync)
    return () => mq.removeEventListener("change", sync)
  }, [])

  const minCols = isMobile ? 1 : 2
  const maxCols = 8

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setColumnCount((prev) => Math.min(maxCols, Math.max(minCols, prev)))
  }, [maxCols, minCols])

  useEffect(() => {
    if (!showColumnsControl) return
    const raw = window.localStorage.getItem(columnsStorageKey)
    const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
    if (Number.isFinite(parsed)) {
      const next = Math.min(maxCols, Math.max(minCols, parsed))
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setColumnCount(next)
    }
    setColumnsLoaded(true)
  }, [columnsStorageKey, maxCols, minCols, showColumnsControl])

  useEffect(() => {
    if (!showColumnsControl || !columnsLoaded) return
    const safe = Math.min(maxCols, Math.max(minCols, Math.round(columnCount)))
    window.localStorage.setItem(columnsStorageKey, String(safe))
  }, [
    columnCount,
    columnsLoaded,
    columnsStorageKey,
    maxCols,
    minCols,
    showColumnsControl,
  ])

  const cols = useMemo(() => {
    if (!contentWidth) return minCols
    return showColumnsControl
      ? getColumnCount(contentWidth, columnCount)
      : getColumnCount(contentWidth)
  }, [columnCount, contentWidth, minCols, showColumnsControl])

  const pageSize = useMemo(
    () => (fixedPageSize && fixedPageSize > 0 ? fixedPageSize : cols * 3),
    [cols, fixedPageSize]
  )
  const [visibleCount, setVisibleCount] = useState<number>(pageSize)
  const [queueSize, setQueueSize] = useState(0)
  const appendedIdsRef = useRef(new Set(items.map((item) => item.id)))
  const incomingQueueRef = useRef<FeedItem[]>([])
  const processingQueueRef = useRef(false)
  const requestSeqRef = useRef(0)

  // Keep the current progress when resizing, but never show fewer than one page.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisibleCount((prev) => Math.max(pageSize, prev))
  }, [pageSize])

  const getRatio = useCallback(
    (item: FeedItem) => {
      const r = ratios[item.id]
      if (typeof r === "number" && Number.isFinite(r) && r > 0) return r
      if (
        item.mediaWidth &&
        item.mediaHeight &&
        item.mediaWidth > 0 &&
        item.mediaHeight > 0
      ) {
        return item.mediaHeight / item.mediaWidth
      }
      return 4 / 3
    },
    [ratios]
  )

  const onRatio = useCallback((id: string, next: number) => {
    if (!Number.isFinite(next) || next <= 0) return
    setRatios((prev) => (prev[id] === next ? prev : { ...prev, [id]: next }))
  }, [])

  const page = useMemo(
    () =>
      remotePagination
        ? filtered
        : filtered.slice(0, Math.min(filtered.length, visibleCount)),
    [filtered, remotePagination, visibleCount]
  )

  const loadingMoreRef = useRef(false)

  useEffect(() => {
    appendedIdsRef.current = new Set(loadedItems.map((item) => item.id))
  }, [loadedItems])

  const flushIncomingQueue = useCallback(async () => {
    if (processingQueueRef.current) return
    processingQueueRef.current = true

    try {
      while (incomingQueueRef.current.length > 0) {
        const next = incomingQueueRef.current.shift()
        setQueueSize(incomingQueueRef.current.length)
        if (!next) break
        if (appendedIdsRef.current.has(next.id)) continue
        const appendStart = performance.now()

        setLoadedItems((prev) => {
          if (prev.some((item) => item.id === next.id)) return prev
          return [...prev, next]
        })
        logFeedDebug("appended item", {
          itemId: next.id,
          queueRemaining: incomingQueueRef.current.length,
          appendMs: Number((performance.now() - appendStart).toFixed(1)),
        })
        // Yield between inserts so the browser can paint progressively.
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
      }
    } finally {
      processingQueueRef.current = false
    }
  }, [])

  const getNext = useCallback(() => {
    if (remotePagination) {
      if (remoteLoading || !hasRemoteMore) return
      const qs = new URLSearchParams()
      qs.set("count", String(remotePagination.count))
      if (nextCursor) qs.set("after", nextCursor)
      const reqId = ++requestSeqRef.current
      const startedAt = performance.now()
      const requestUrl = `${remotePagination.endpoint}?${qs.toString()}`
      logFeedDebug("remote fetch start", {
        reqId,
        url: requestUrl,
        filteredLength: filtered.length,
        hasRemoteMore,
      })

      setRemoteLoading(true)
      fetch(requestUrl)
        .then(async (res) => {
          const responseMs = performance.now() - startedAt
          logFeedDebug("remote fetch response", {
            reqId,
            ok: res.ok,
            status: res.status,
            responseMs: Number(responseMs.toFixed(1)),
          })
          if (!res.ok) return null
          const parseStart = performance.now()
          const parsed = (await res.json()) as {
            items?: FeedItem[]
            nextCursor?: string
            hasNextPage?: boolean
          }
          logFeedDebug("remote fetch parse", {
            reqId,
            parseMs: Number((performance.now() - parseStart).toFixed(1)),
          })
          return parsed
        })
        .then((json) => {
          if (!json) return
          const incoming = json.items ?? []
          const queuedBefore = incomingQueueRef.current.length
          const processStart = performance.now()
          if (incoming.length > 0) {
            const known = appendedIdsRef.current
            const queued = new Set(incomingQueueRef.current.map((item) => item.id))
            const deduped = incoming.filter(
              (item) => !known.has(item.id) && !queued.has(item.id)
            )
            logFeedDebug("remote payload received", {
              reqId,
              incomingCount: incoming.length,
              dedupedCount: deduped.length,
              queuedBefore,
            })
            if (deduped.length > 0) {
              incomingQueueRef.current.push(...deduped)
              setQueueSize(incomingQueueRef.current.length)
              logFeedDebug("queue updated", {
                reqId,
                queueSize: incomingQueueRef.current.length,
              })
              void flushIncomingQueue()
            }
          }
          setNextCursor(json.nextCursor)
          setHasRemoteMore(Boolean(json.hasNextPage && json.nextCursor))
          logFeedDebug("remote fetch done", {
            reqId,
            totalMs: Number((performance.now() - startedAt).toFixed(1)),
            processMs: Number((performance.now() - processStart).toFixed(1)),
            nextCursor: json.nextCursor ?? null,
            hasNextPage: Boolean(json.hasNextPage),
          })
        })
        .catch((err) => {
          logFeedDebug("remote fetch error", {
            reqId,
            totalMs: Number((performance.now() - startedAt).toFixed(1)),
            error: err instanceof Error ? err.message : String(err),
          })
        })
        .finally(() => {
          setRemoteLoading(false)
          logFeedDebug("remote loading false", {
            reqId,
            totalMs: Number((performance.now() - startedAt).toFixed(1)),
          })
        })

      return
    }

    if (loadingMoreRef.current) return
    if (visibleCount >= filtered.length) return
    loadingMoreRef.current = true
    // Batch by 3 rows.
    setVisibleCount((c) => Math.min(filtered.length, c + pageSize))
    // Allow further triggers next tick.
    queueMicrotask(() => {
      loadingMoreRef.current = false
    })
  }, [
    filtered.length,
    hasRemoteMore,
    nextCursor,
    pageSize,
    remoteLoading,
    remotePagination,
    visibleCount,
    flushIncomingQueue,
  ])

  const { sentinelRef } = useInfiniteScroll({
    enabled: remotePagination
      ? filtered.length > 0 && hasRemoteMore && !remoteLoading && queueSize === 0
      : filtered.length > 0 && visibleCount < filtered.length,
    getNext,
    rootMargin: "400px",
  })

  const createdAtLabel = formatCreatedAt(selectedItem?.createdAt)
  const modalImageUrl = selectedItem?.mediaPreviewUrl ?? selectedItem?.mediaUrl
  const isVideo = Boolean(selectedItem?.mediaMimeType?.startsWith("video/"))
  const description =
    selectedItem?.description.trim() && selectedItem.description.trim().length > 0
      ? selectedItem.description
      : "Sem descricao."

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-center px-4 py-3">
          <Link
            href="/"
            className="text-xl font-semibold tracking-tight text-foreground"
          >
            toca
          </Link>
        </div>
      </header>

      <div className="w-full">
        {topSlot ? (
          <section className="w-full px-1 pb-1 pt-4 sm:pb-1 sm:pt-5">
            {topSlot}
          </section>
        ) : null}
        <main>
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
              {showColumnsControl ? (
                <section className="border-y border-zinc-300 bg-white px-4 py-3 sm:px-6">
                  <div className="flex items-center justify-between gap-4">
                    <div
                      className="text-xs uppercase tracking-[0.18em] text-zinc-500"
                      style={{ fontFamily: "ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}
                    >
                      {columnsTitle}
                    </div>
                    <div className="flex min-w-[200px] items-center gap-3 sm:min-w-[280px]">
                      <label className="whitespace-nowrap text-xs text-zinc-600">
                        Colunas:
                      </label>
                      <Slider
                        min={minCols}
                        max={maxCols}
                        step={1}
                        value={[columnCount]}
                        onValueChange={(value) => setColumnCount(value[0] ?? minCols)}
                        className="w-full"
                        aria-label="Numero de colunas"
                      />
                      <span className="min-w-6 whitespace-nowrap rounded border border-zinc-300 px-1.5 py-0.5 text-center text-xs text-zinc-700">
                        {columnCount}
                      </span>
                    </div>
                  </div>
                </section>
              ) : null}
              <TrueMasonry
                items={page}
                getRatio={getRatio}
                onRatio={onRatio}
                forcedCols={showColumnsControl ? columnCount : undefined}
                onOpen={(item) => {
                  setSelectedItem(item)
                  setDialogOpen(true)
                }}
              />
              <div ref={sentinelRef} className="h-10" />
              <div className="px-3 pb-6 text-xs text-muted-foreground sm:px-4">
                {remotePagination
                  ? `Showing ${page.length}${hasRemoteMore ? " +" : ""}`
                  : `Showing ${page.length} / ${filtered.length}`}
              </div>
            </div>
          )}
        </main>

        {showFooter ? (
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
        ) : null}
      </div>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open)
          if (!open) setSelectedItem(null)
        }}
      >
        <DialogContent className="h-dvh max-h-dvh w-screen max-w-none overflow-y-auto p-0 sm:h-auto sm:max-h-[90vh] sm:max-w-4xl sm:p-6">
          {selectedItem ? (
            <div className="grid gap-4 p-4 sm:grid-cols-2 sm:gap-6 sm:p-0">
              <div className="overflow-hidden">
                <div className="relative aspect-square w-full">
                  {isVideo && selectedItem.mediaUrl ? (
                    <video
                      className="absolute inset-0 h-full w-full object-contain"
                      src={selectedItem.mediaUrl}
                      controls
                      playsInline
                      preload="metadata"
                    />
                  ) : modalImageUrl ? (
                    <img
                      className="absolute inset-0 h-full w-full object-contain"
                      src={modalImageUrl}
                      alt={selectedItem.title}
                      width={selectedItem.mediaWidth}
                      height={selectedItem.mediaHeight}
                    />
                  ) : (
                    <div className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">
                      Midia indisponivel
                    </div>
                  )}
                </div>
              </div>

              <div className="flex min-h-0 flex-col gap-4">
                <DialogHeader>
                  <DialogTitle>{selectedItem.title}</DialogTitle>
                  <DialogDescription>
                    por{" "}
                    {selectedItem.creatorHandle ? (
                      <Link href={`/u/${encodeURIComponent(selectedItem.creatorHandle)}`}>
                        @{selectedItem.creatorHandle}
                      </Link>
                    ) : (
                      "artista desconhecido"
                    )}
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-2 text-sm">
                  <p className="text-muted-foreground">{description}</p>
                  <div className="text-xs text-muted-foreground">
                    <span>{selectedItem.symbol}</span>
                    {createdAtLabel ? <span> · {createdAtLabel}</span> : null}
                  </div>
                </div>

                <div className="mt-auto flex flex-wrap items-center gap-2">
                  <Button asChild variant="outline" size="sm">
                    <a href={getZoraUrl(selectedItem)} target="_blank" rel="noreferrer">
                      Abrir no Zora
                    </a>
                  </Button>
                  {selectedItem.mediaUrl ? (
                    <Button asChild variant="outline" size="sm">
                      <a
                        href={selectedItem.mediaUrl}
                        download
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        Download media
                      </a>
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
