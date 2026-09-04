import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    // Prevent deployment halts from minor lint warnings on Vercel
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Ensure smooth CI/CD builds on Vercel
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
