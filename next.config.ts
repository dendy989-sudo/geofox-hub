import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      { source: "/auth/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }, { key: "Cache-Control", value: "private, no-store" }, { key: "X-Robots-Tag", value: "noindex" }] },
      { source: "/admin/:path*", headers: [{ key: "Cache-Control", value: "private, no-store" }, { key: "X-Robots-Tag", value: "noindex" }] },
    ];
  },
};

export default nextConfig;
