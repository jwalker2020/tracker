import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow dev access from LAN IP (e.g. http://192.168.1.199:3000) in addition to localhost.
  allowedDevOrigins: ["192.168.1.199"],
};

export default nextConfig;
