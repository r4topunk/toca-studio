import { NextResponse } from "next/server";
import { getArtistFeedPage } from "@/lib/zora-feed";

type RouteParams = {
  params: Promise<{ handle: string }>;
};

export async function GET(req: Request, { params }: RouteParams) {
  const p = await params;
  const url = new URL(req.url);
  const after = url.searchParams.get("after") ?? undefined;
  const countRaw = Number(url.searchParams.get("count") ?? "18");
  const count = Number.isFinite(countRaw)
    ? Math.max(1, Math.min(50, Math.floor(countRaw)))
    : 18;

  const { items, failed, nextCursor, hasNextPage } = await getArtistFeedPage(
    p.handle,
    after,
    count
  );

  if (failed) {
    return NextResponse.json(
      { items: [], nextCursor: undefined, hasNextPage: false },
      { status: 502 }
    );
  }

  return NextResponse.json({ items, nextCursor, hasNextPage });
}
