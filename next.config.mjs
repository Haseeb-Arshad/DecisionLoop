/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["pino", "postgres", "pdf-parse"],
  // The container runs the custom server so web requests and the worker
  // use the same services. It packages .next plus the runtime sources.
};

export default nextConfig;
