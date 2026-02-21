/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: '100mb',
    },
  },
  serverExternalPackages: ['ssh2', 'dockerode', 'cpu-features', 'sshpk'],
  turbopack: {
    root: __dirname,
  },
};

module.exports = nextConfig;
