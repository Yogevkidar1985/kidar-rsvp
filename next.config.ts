import type { NextConfig } from 'next';

// uploaded photos live in the project's own storage: only that host may be resized
const storage = (() => { try { return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''); } catch { return null; } })();

const config: NextConfig = {
  poweredByHeader: false,
  images: {
    remotePatterns: storage ? [{ protocol: storage.protocol.replace(':', '') as 'http' | 'https', hostname: storage.hostname, port: storage.port, pathname: '/storage/v1/object/public/**' }] : [],
    minimumCacheTTL: 60 * 60 * 24 * 31,
  },
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      ],
    }, {
      source: '/admin/:path*',
      headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }, { key: 'Cache-Control', value: 'no-store' }],
    }];
  },
};
export default config;
