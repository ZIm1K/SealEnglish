import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Fully static build: Wasmer Edge serves ./out, all server logic lives in Supabase Edge Functions.
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
