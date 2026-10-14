/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: '100mb',
    },
    // Requests to tenant apps pass through src/proxy.ts, which otherwise cuts
    // bodies at 10 MB without an error — media uploads would arrive truncated.
    // ponytail: the body is buffered in the web process, so concurrent large
    // uploads cost memory; raise only when tenants need bigger uploads.
    proxyClientMaxBodySize: '64mb',
  },
  serverExternalPackages: ['ssh2', 'dockerode', 'cpu-features', 'sshpk'],
  turbopack: {
    root: __dirname,
  },
};

module.exports = nextConfig;
