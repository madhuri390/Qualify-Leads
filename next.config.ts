import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // There's a stray package-lock.json in the home directory, so Next infers
  // the workspace root as ~ and warns. Pin it to this project.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
