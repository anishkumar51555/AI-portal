import type { NextConfig } from "next";

// See docs/08-security-model.md section 6 for the reasoning behind each header.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
];

const nextConfig: NextConfig = {
  // Required by the production DOCKERFILE (docs/05 §5): Next traces exactly the
  // node_modules it needs, so the runner stage stays small.
  //
  // Disabled on Vercel, which does its own tracing and bundling. With
  // standalone on, Next writes the trace into .next/standalone and Vercel's
  // onBuildComplete then dies looking for a file that was never emitted:
  //
  //   ENOENT: no such file or directory, open '.next/next-server.js.nft.json'
  //
  // The build otherwise succeeds completely — compile, typecheck, page data and
  // static generation all pass — so the failure looks like a platform bug
  // rather than a config conflict.
  output: process.env.VERCEL ? undefined : "standalone",

  reactStrictMode: true,

  images: {
    remotePatterns: [{ protocol: "https", hostname: "avatars.githubusercontent.com" }],
  },

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
