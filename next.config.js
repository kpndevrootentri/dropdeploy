/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Caddy compresses at the edge (`encode zstd gzip`); gzipping in this one Node process would cost CPU for every tenant.
  compress: false,
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
  // Keeps request.url in src/proxy.ts as the address Next is bound to, so tenant
  // rewrites built from it stay internal under `next start -H 127.0.0.1`.
  skipProxyUrlNormalize: true,
  // Tenant apps own their URLs: stripping "/calculate/" to "/calculate" loops
  // with Django's APPEND_SLASH. src/proxy.ts still strips it for platform pages.
  skipTrailingSlashRedirect: true,
  serverExternalPackages: ['ssh2', 'dockerode', 'cpu-features', 'sshpk'],
  turbopack: {
    root: __dirname,
  },
};

module.exports = nextConfig;
