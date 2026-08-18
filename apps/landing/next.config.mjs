/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next 16 would auto-generate AGENTS.md/CLAUDE.md; keep the repo tree explicit.
  agentRules: false,
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? "",
}

export default nextConfig
