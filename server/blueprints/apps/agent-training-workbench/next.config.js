/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: [],
  swcMinify: true,
  basePath: '',
  env: {
    NEXT_PUBLIC_PLATFORM_URL: process.env.ODDJOB_PLATFORM_URL ?? 'http://localhost:5000',
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
          },
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'self';",
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
