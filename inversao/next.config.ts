import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // A skill é lida do disco em tempo de execução, por isso tem de ir no pacote de produção.
  outputFileTracingIncludes: {
    "/api/analisar": ["./skill/**/*"],
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
