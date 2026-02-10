import { getProfileCoins } from "@zoralabs/coins-sdk";

function toHttpUrl(uri) {
  if (typeof uri !== "string") return undefined;
  if (uri.startsWith("ipfs://")) return `https://ipfs.io/ipfs/${uri.slice(7)}`;
  if (uri.startsWith("ar://")) return `https://arweave.net/${uri.slice(5)}`;
  return uri;
}

async function main() {
  const identifier = process.argv[2] ?? "cyshimi";
  const r = await getProfileCoins({ identifier, count: 5 });

  const err = "error" in r ? r.error : undefined;
  if (err) {
    console.error("getProfileCoins error:", err);
    process.exitCode = 1;
    return;
  }

  const data = "data" in r ? r.data : undefined;
  const edges = data?.profile?.createdCoins?.edges ?? [];
  console.log("coins:", edges.length);

  for (const e of edges.slice(0, 3)) {
    const coin = e.node;
    console.log("\ncoin keys:", Object.keys(coin).sort());
    console.log("name:", coin.name);
    console.log("address:", coin.address);
    console.log("tokenUri:", coin.tokenUri);
    if (coin.mediaContent) {
      console.log("mediaContent keys:", Object.keys(coin.mediaContent).sort());
      console.log("mediaContent:", JSON.stringify(coin.mediaContent, null, 2));
    }

    const tokenUri = toHttpUrl(coin.tokenUri);
    if (!tokenUri) continue;

    const res = await fetch(tokenUri);
    console.log("metadata status:", res.status);
    if (!res.ok) continue;
    const json = await res.json();
    const obj = json && typeof json === "object" ? json : {};
    console.log("metadata keys:", Object.keys(obj).sort());
    console.log("image:", obj.image);
    console.log("animation_url:", obj.animation_url);
    console.log("width/height:", obj.width, obj.height);
    console.log("mimeType:", obj.mimeType);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
