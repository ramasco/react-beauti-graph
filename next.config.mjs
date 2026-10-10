import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Pin the project root so a stray lockfile in a parent folder isn't picked up
  turbopack: {
    root: path.dirname(fileURLToPath(import.meta.url)),
  },
};

export default nextConfig;
