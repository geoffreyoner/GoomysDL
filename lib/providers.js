const PROVIDERS = [
  {
    id: 'spotify',
    name: 'Spotify',
    mode: 'single',
    domains: ['spotify.com', 'spotify.link'],
    referer: 'https://open.spotify.com/',
  },
  {
    id: 'terabox',
    name: 'TeraBox',
    mode: 'collection',
    domains: [
      'terabox.com',
      '1024tera.com',
      '1024terabox.com',
      'terabox.app',
      'teraboxapp.com',
      'teraboxlink.com',
      'teraboxshare.com',
      'terasharelink.com',
      'terafileshare.com',
      'teraboxcdn.com',
      '4funbox.com',
      'freeterabox.com',
      'mirrobox.com',
      'nephobox.com',
      'momerybox.com',
      'tibibox.com',
      'gibibox.com',
    ],
    referer: 'https://www.terabox.com/',
  },
  {
    id: 'threads',
    name: 'Threads',
    mode: 'auto',
    domains: ['threads.net', 'threads.com'],
    referer: 'https://www.threads.net/',
  },
  {
    id: 'pixiv',
    name: 'Pixiv',
    mode: 'auto',
    domains: ['pixiv.net'],
    referer: 'https://www.pixiv.net/',
  },
  {
    id: 'douyin',
    name: 'Douyin',
    mode: 'auto',
    domains: ['douyin.com', 'iesdouyin.com'],
    referer: 'https://www.douyin.com/',
  },
  {
    id: 'mediafire',
    name: 'MediaFire',
    mode: 'auto',
    domains: ['mediafire.com'],
  },
  {
    id: 'pixeldrain',
    name: 'Pixeldrain',
    mode: 'auto',
    domains: ['pixeldrain.com'],
  },
  {
    id: 'catbox',
    name: 'Catbox',
    mode: 'auto',
    domains: ['catbox.moe'],
  },
  {
    id: 'gdrive',
    name: 'Google Drive',
    mode: 'auto',
    domains: ['drive.google.com', 'docs.google.com'],
  },
  {
    id: 'sfile',
    name: 'Sfile',
    mode: 'auto',
    domains: ['sfile.co', 'sfile.mobi'],
  },
  {
    id: 'krakenfiles',
    name: 'Krakenfiles',
    mode: 'auto',
    domains: ['krakenfiles.com'],
  },
  {
    id: 'doodstream',
    name: 'Doodstream',
    mode: 'auto',
    domains: ['dood.to', 'ds2play.com', 'doodstream.com', 'd0000d.com'],
  },
  {
    id: 'komiku',
    name: 'Komiku',
    mode: 'collection',
    domains: ['komiku.org'],
    referer: 'https://komiku.org/',
  },
  {
    id: 'komikindo',
    name: 'Komikindo',
    mode: 'collection',
    domains: ['komikindo.ch', 'komikindo.id'],
    referer: 'https://komikindo.ch/',
  },
  {
    id: 'asurascans',
    name: 'Asura Scans',
    mode: 'collection',
    domains: ['asurascans.com', 'asuracomic.net'],
    referer: 'https://asurascans.com/',
  },
  {
    id: 'mangadex',
    name: 'MangaDex',
    mode: 'collection',
    domains: ['mangadex.org'],
    referer: 'https://mangadex.org/',
  },
  {
    id: 'nimegami',
    name: 'Nimegami',
    mode: 'auto',
    domains: ['nimegami.id'],
    referer: 'https://nimegami.id/',
  },
];

function matchesHost(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
}

export function providerFor(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  return PROVIDERS.find((provider) => provider.domains.some((domain) => matchesHost(host, domain))) || null;
}

export function providerById(id) {
  return PROVIDERS.find((provider) => provider.id === id) || null;
}

export { PROVIDERS };
