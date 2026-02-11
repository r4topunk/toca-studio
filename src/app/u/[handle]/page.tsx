import { notFound } from "next/navigation";
import { getArtistFeedPage } from "@/lib/zora-feed";
import { FeedClient } from "@/app/feed-client";

type PageProps = {
  params: Promise<{ handle: string }>; // Next 15 route params are async
};

function buildSocialLinks(social?: {
  twitter?: string;
  instagram?: string;
  farcaster?: string;
  tiktok?: string;
}) {
  const links: Array<{ label: string; href: string }> = [];
  if (social?.twitter) links.push({ label: "Twitter", href: `https://twitter.com/${social.twitter}` });
  if (social?.instagram) links.push({ label: "Instagram", href: `https://instagram.com/${social.instagram}` });
  if (social?.farcaster) links.push({ label: "Farcaster", href: `https://warpcast.com/${social.farcaster}` });
  if (social?.tiktok) links.push({ label: "TikTok", href: `https://www.tiktok.com/@${social.tiktok}` });
  return links;
}

export default async function ArtistPage({ params }: PageProps) {
  const p = await params;
  const raw = p.handle;
  const handle = raw.replace(/^@+/, "");

  const PAGE_SIZE = 18;
  const { profile, items, failed, nextCursor, hasNextPage } =
    await getArtistFeedPage(handle, undefined, PAGE_SIZE);
  if (!profile && !failed) return notFound();
  if (!profile && failed) {
    return (
      <div className="min-h-screen">
        <FeedClient items={[]} />
        <div className="mx-auto max-w-4xl px-4 py-8 text-sm text-muted-foreground">
          Nao foi possivel carregar o perfil agora. Tente novamente.
        </div>
      </div>
    );
  }
  if (!profile) return notFound();

  const artist = profile;
  const links = [
    ...buildSocialLinks(artist.social),
    { label: "Zora", href: `https://zora.co/@${encodeURIComponent(artist.handle)}` },
  ];
  const latestCreatedAt = items
    .map((item) => (item.createdAt ? Date.parse(item.createdAt) : 0))
    .filter((ts) => ts > 0)
    .sort((a, b) => b - a)[0];
  const latestLabel = latestCreatedAt
    ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(
        new Date(latestCreatedAt)
      )
    : null;
  const banner = (
    <div className="overflow-hidden border border-zinc-300 bg-white">
      <div>
        <div className="relative overflow-hidden border-b border-zinc-300 bg-white px-4 pb-6 pt-5 sm:px-6 sm:pb-7 sm:pt-6">
          <div className="pointer-events-none absolute -right-8 -top-10 h-40 w-40 rounded-full bg-zinc-200/70 blur-2xl" />
          <div className="relative min-w-0">
            <div className="flex items-stretch gap-3 sm:gap-4">
              <div className="relative w-28 self-stretch shrink-0 overflow-hidden bg-zinc-200 sm:w-36">
                {artist.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={artist.avatarUrl}
                    alt={`Avatar de @${artist.handle}`}
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                ) : (
                  <div className="absolute inset-0 bg-zinc-300" />
                )}
              </div>

              <div className="min-w-0">
                <h1
                  className="truncate text-4xl leading-none tracking-tight text-zinc-900 sm:text-5xl"
                  style={{ fontFamily: "Georgia, Times, serif" }}
                >
                  @{artist.handle}
                </h1>
                <div
                  className="mt-2 flex flex-wrap gap-2 text-xs sm:mt-3"
                  style={{ fontFamily: "ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}
                >
                  <span className="border border-zinc-300 bg-white px-3 py-1.5 text-zinc-700">
                    {items.length} obras
                  </span>
                  {latestLabel ? (
                    <span className="border border-zinc-300 bg-white px-3 py-1.5 text-zinc-700">
                      ultimo drop: {latestLabel}
                    </span>
                  ) : null}
                </div>

                {links.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {links.map((l) => (
                      <a
                        key={l.href}
                        href={l.href}
                        target="_blank"
                        rel="noreferrer"
                        className="border border-zinc-300 bg-white px-3 py-1.5 text-xs text-zinc-700 transition-colors hover:border-zinc-700 hover:bg-zinc-700 hover:text-white"
                        style={{ fontFamily: "ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}
                      >
                        {l.label}
                      </a>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <FeedClient
      items={items}
      topSlot={banner}
      showColumnsControl
      columnsTitle="Obras selecionadas"
      columnsStorageKey="toca:columns:profile"
      pageSize={18}
      remotePagination={{
        endpoint: `/api/artist/${encodeURIComponent(artist.handle)}/works`,
        initialCursor: nextCursor,
        initialHasNextPage: hasNextPage,
        count: PAGE_SIZE,
      }}
    />
  );
}
