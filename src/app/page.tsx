import { FeedClient } from "@/app/feed-client";
import { FEED_PROFILES } from "@/lib/profiles";
import { getHomeFeed } from "@/lib/zora-feed";

export default async function Home() {
  const items =
    FEED_PROFILES.length === 0 ? [] : await getHomeFeed(FEED_PROFILES);
  return <FeedClient items={items} />;
}
