/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["pino", "postgres", "pdf-parse"],
  eslint: {
    // Lint runs as its own CI/dev step; don't block production builds on it.
    ignoreDuringBuilds: true,
  },
  // Standalone output is what the Dockerfile fallback deployment (App
  // Runner/ECS) copies into its runtime image — a self-contained server
  // bundle with only the production deps it actually uses. Amplify Hosting,
  // the primary deployment target, ignores this and runs `next start`
  // normally.
  output: process.env.DOCKER_BUILD ? "standalone" : undefined,
};

export default nextConfig;
