import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // @kase/db is a workspace package consumed as TypeScript source.
  transpilePackages: ['@kase/db'],
};

export default nextConfig;
