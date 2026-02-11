import { getProfileCoins } from '@zoralabs/coins-sdk';

const FEED_PROFILES = [
  'cyshimi','seedcomputer','rebudigital','brendyzinha','elbi','tir3d','lucasborges','pwdro','l444u','qabqabqab','4nd7ro','femzor','ileogivel'
];

function toHttpUrl(uri) {
  if (!uri) return undefined;
  if (uri.startsWith('ipfs://')) return `https://ipfs.io/ipfs/${uri.slice('ipfs://'.length)}`;
  if (uri.startsWith('ar://')) return `https://arweave.net/${uri.slice('ar://'.length)}`;
  return uri;
}

async function withTimeout(p, ms) {
  return await Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))
  ]);
}

const results = await Promise.all(FEED_PROFILES.map(async (identifier) => {
  try {
    const r = await withTimeout(getProfileCoins({ identifier, count: 12 }), 4000);
    if ('error' in r && r.error) return [];
    return ('data' in r ? r.data?.profile?.createdCoins?.edges?.map(e => e.node) : []) ?? [];
  } catch {
    return [];
  }
}));

const items = [];
for (const coin of results.flat()) {
  const mc = coin.mediaContent || {};
  let mediaPreviewUrl;
  let mediaUrl;
  let mediaMimeType;
  if (mc?.mimeType) mediaMimeType = mc.mimeType;
  if (mc?.mimeType?.startsWith('image/')) {
    mediaPreviewUrl = mc.previewImage?.medium ?? mc.previewImage?.small;
    mediaUrl = mediaPreviewUrl;
    if (!mediaUrl && mc.originalUri) mediaUrl = toHttpUrl(mc.originalUri);
  } else if (mc?.mimeType?.startsWith('video/')) {
    mediaPreviewUrl = mc.previewImage?.medium ?? mc.previewImage?.small;
    if (mc.originalUri) mediaUrl = toHttpUrl(mc.originalUri);
  }

  items.push({
    title: coin.name,
    createdAt: coin.createdAt,
    mediaMimeType,
    mediaPreviewUrl,
    mediaUrl,
    displayUrl: mediaPreviewUrl ?? mediaUrl,
  });
}

items.sort((a,b) => (Date.parse(b.createdAt || '0') - Date.parse(a.createdAt || '0')));
for (const [i, x] of items.slice(0, 15).entries()) {
  console.log(JSON.stringify({
    i,
    createdAt: x.createdAt,
    title: x.title,
    mime: x.mediaMimeType,
    hasPreview: !!x.mediaPreviewUrl,
    hasMedia: !!x.mediaUrl,
    displayUrl: x.displayUrl,
  }));
}
