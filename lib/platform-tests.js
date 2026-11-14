import { explainError } from './errors.js';
import { galleryAvailable, galleryInspect, isGalleryPhotoUrl } from './gallery.js';
import { providerFor } from './providers.js';
import { scraperInspect } from './scraper.js';
import { normalizeInfo, parseMediaUrl } from './validate.js';
import { inspect } from './ytdlp.js';

export const TEST_SAMPLES = {
  tiktok: 'https://www.tiktok.com/@cookierun_dev/video/7039716639834656002',
  instagram: 'https://www.instagram.com/p/BQ0eAlwhDrw/',
  twitter: 'https://x.com/NASA/status/2119083432835764635',
  youtube: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  facebook: 'https://www.facebook.com/watch/?v=1648000029477006',
  reddit: 'https://www.reddit.com/r/aww/comments/90bu6w/heat_index_was_110_degrees_so_we_offered_him_a/',
  vimeo: 'https://vimeo.com/76979871',
  twitch: 'https://www.twitch.tv/videos/6528877',
  soundcloud: 'https://soundcloud.com/forss/flickermood',
  dailymotion: 'https://www.dailymotion.com/video/x5kesuj_office-christmas-party-review-jason-bateman-olivia-munn-t-j-miller_news',
  spotify: 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT',
  terabox: 'https://www.terabox.com/sharing/link?surl=lP4qO4DsYJvmGDs3yGX3_w',
  threads: 'https://www.threads.net/@krappybutkutenailart/post/DBK_PugJ7N-',
  pixiv: 'https://www.pixiv.net/artworks/140893823',
  douyin: 'https://www.iesdouyin.com/share/video/7432862707184913674/',
  mediafire: 'https://www.mediafire.com/file/w4b1fjoijyug9qz/nix.py/file',
  pixeldrain: 'https://pixeldrain.com/d/8xz8hcYJ',
  catbox: 'https://files.catbox.moe/8ih3y7.png',
  gdrive: 'https://drive.google.com/file/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/view',
  sfile: 'https://sfile.co/23716tIsVOv',
  krakenfiles: 'https://krakenfiles.com/view/rgsINUTYUi/file.html',
  doodstream: 'https://dood.to/e/5s1wmbdacezb',
  komiku: 'https://komiku.org/one-piece-ace-story-chapter-01/',
  komikindo: 'https://komikindo.ch/one-punch-man-chapter-310/',
  asurascans: 'https://asurascans.com/comics/the-wandering-knights-survival-manual/chapter/chapter-67',
  mangadex: 'https://mangadex.org/chapter/1690f93f-219f-4ba5-9604-905546e01cc9',
  nimegami: 'https://nimegami.id/girls-band-cry-sub-indo/download/1/720p/af71785b82edbb2ccec4/',
};

const LOGIN = /sign in|log ?in|login|cookies|auth|private|rate.?limit|401|unauthorized/i;
const TIMEOUT = /timed? ?out|timeout|too long/i;

export function classifyTestError(err) {
  const explained = explainError(err);
  if (LOGIN.test(explained)) return 'login';
  if (TIMEOUT.test(explained)) return 'timeout';
  if (err?.killed || err?.signal || err?.code === 'ETIMEDOUT') return 'timeout';
  return 'fail';
}

async function inspectSample(url, timeoutMs) {
  const provider = providerFor(url);
  if (provider) {
    const { info } = await scraperInspect(url, { timeoutMs });
    return info;
  }

  let raw;
  try {
    raw = await inspect(url, { timeoutMs });
  } catch (err) {
    if (!isGalleryPhotoUrl(url)) throw err;
    if (!(await galleryAvailable())) throw err;
    try {
      raw = await galleryInspect(url, { timeoutMs });
    } catch (galleryErr) {
      if (/no photos found/i.test(galleryErr.message)) throw err;
      throw galleryErr;
    }
  }
  const info = normalizeInfo(raw);
  if (!info.entries.length) throw new Error('No downloadable media found at this URL.');
  return info;
}

export async function testPlatform(id, { timeoutMs = 30_000 } = {}) {
  const sample = TEST_SAMPLES[id];
  if (!sample) throw new Error('Unknown platform.');
  const startedAt = Date.now();
  try {
    const url = parseMediaUrl(sample);
    const info = await inspectSample(url, timeoutMs);
    return {
      id,
      status: 'ok',
      title: info.title,
      latency: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      id,
      status: classifyTestError(err),
      error: explainError(err),
      latency: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
    };
  }
}
