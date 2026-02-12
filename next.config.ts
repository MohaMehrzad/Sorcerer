import type { NextConfig } from "next";

const appRole = process.env.APP_ROLE === "backend" ? "backend" : "frontend";
const backendApiOrigin =
  process.env.BACKEND_API_ORIGIN?.trim() || "http://127.0.0.1:7778";
const distDir = appRole === "backend" ? ".next/backend" : ".next/frontend";

const nextConfig: NextConfig = {
  distDir,
  async rewrites() {
    if (appRole !== "frontend") {
      return [];
    }

    return {
      beforeFiles: [
        {
          source: "/api/:path*",
          destination: `${backendApiOrigin}/api/:path*`,
        },
      ],
    };
  },
};

export default nextConfig;
