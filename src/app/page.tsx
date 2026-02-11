import { FeedClient } from "@/app/feed-client";
import { getHybridHomeFeedPage } from "@/lib/home-feed-cache";

export default async function Home() {
  const PAGE_SIZE = 36;
  const cached = await getHybridHomeFeedPage(undefined, PAGE_SIZE);
  const { items, nextCursor, hasNextPage } = cached;

  return (
    <FeedClient
      items={items}
      showColumnsControl
      columnsTitle="Artistas brasileiros"
      columnsStorageKey="toca:columns:home"
      remotePagination={{
        endpoint: "/api/home/works",
        initialCursor: nextCursor,
        initialHasNextPage: hasNextPage,
        count: PAGE_SIZE,
      }}
    />
  );
}
