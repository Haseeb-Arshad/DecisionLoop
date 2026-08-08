/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["pino", "postgres"],
  eslint: {
    // Lint runs as its own CI/dev step; don't block production builds on it.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
