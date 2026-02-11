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
  const links = buildSocialLinks(artist.social);
  const latestCreatedAt = items
    .map((item) => (item.createdAt ? Date.parse(item.createdAt) : 0))
    .filter((ts) => ts > 0)
    .sort((a, b) => b - a)[0];
  const latestLabel = latestCreatedAt
    ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(
        new Date(latestCreatedAt)
      )
    : null;
  const zoraProfileUrl = `https://zora.co/@${encodeURIComponent(artist.handle)}`;
  const banner = (
    <div className="overflow-hidden border border-zinc-300 bg-white">
      <div className="grid gap-0 md:grid-cols-[1.3fr_0.7fr]">
        <div className="relative overflow-hidden border-b border-zinc-300 bg-gradient-to-br from-zinc-950 via-zinc-800 to-zinc-600 px-4 pb-6 pt-5 sm:px-6 sm:pb-7 sm:pt-6 md:border-b-0 md:border-r">
          <div className="pointer-events-none absolute -right-8 -top-10 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
          <div className="relative flex items-start gap-3 sm:gap-4">
            {artist.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={artist.avatarUrl}
                alt={`Avatar de @${artist.handle}`}
                width={96}
                height={96}
                className="h-16 w-16 border-2 border-white/80 object-cover shadow-md sm:h-24 sm:w-24"
              />
            ) : (
              <div className="h-16 w-16 border-2 border-white/80 bg-zinc-300 shadow-md sm:h-24 sm:w-24" />
            )}
            <div className="min-w-0">
              <h1
                className="truncate text-4xl leading-none tracking-tight text-white sm:text-5xl"
                style={{ fontFamily: "Georgia, Times, serif" }}
              >
                @{artist.handle}
              </h1>
              <p
                className="mt-1 text-sm text-zinc-200 sm:mt-2 sm:text-base"
                style={{ fontFamily: "ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}
              >
                Artist profile
              </p>
            </div>
          </div>
        </div>

        <div className="bg-zinc-50 px-4 py-4 sm:px-6 sm:py-5">
          <div
            className="flex flex-wrap gap-2 text-xs"
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

          <div className="mt-4 grid grid-cols-2 gap-2">
            <a
              href={zoraProfileUrl}
              target="_blank"
              rel="noreferrer"
              className="border border-zinc-900 bg-zinc-900 px-3 py-2.5 text-center text-sm text-white transition-colors hover:bg-zinc-700"
              style={{ fontFamily: "ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}
            >
              Abrir no Zora
            </a>
            <a
              href={`/u/${encodeURIComponent(artist.handle)}`}
              className="border border-zinc-300 bg-white px-3 py-2.5 text-center text-sm text-zinc-700 transition-colors hover:bg-zinc-200"
              style={{ fontFamily: "ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}
            >
              Permalink
            </a>
          </div>
        </div>
      </div>

      <div className="border-t border-zinc-300 bg-white px-4 py-3 sm:px-6">
        <div
          className="text-xs uppercase tracking-[0.18em] text-zinc-500"
          style={{ fontFamily: "ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}
        >
          Selected Works
        </div>
      </div>
    </div>
  );

  return (
    <FeedClient
      items={items}
      topSlot={banner}
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
