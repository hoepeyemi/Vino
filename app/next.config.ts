import type { NextConfig } from "next";
import path from "path";

const isGitHubPages = process.env.GITHUB_PAGES === "true";

const nextConfig: NextConfig = {
  // Only use static export + basePath for GitHub Pages deployment
  ...(isGitHubPages ? {
    output: "export",
    basePath: "/vino",
  } : {
    output: "standalone",
    // In a pnpm monorepo the standalone output mirrors the full filesystem
    // path, so server.js ends up nested (e.g. /app/repo/app/server.js).
    // Setting outputFileTracingRoot to the monorepo root makes Next.js trace
    // files relative to that root, placing server.js at the standalone root.
    outputFileTracingRoot: path.join(__dirname, "../"),
  }),
  images: { unoptimized: true },
  typescript: { ignoreBuildErrors: true },
  webpack(config) {
    // @wagmi/core's tempo connector does `import('accounts')` with a
    // turbopackOptional comment that webpack doesn't understand.
    // Stub it so webpack doesn't fail on the missing package.
    config.resolve.alias = {
      ...config.resolve.alias,
      accounts: false,
    };
    return config;
  },
};

export default nextConfig;
