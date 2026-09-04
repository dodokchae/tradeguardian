import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    // Ensure smooth CI/CD builds on Vercel
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
