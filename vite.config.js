import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  assetsInclude: ["**/*.obj", "**/*.mtl"],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        trail: resolve(__dirname, "trail.html"),
      },
    },
  },
  server: {
    open: true,
    proxy: {
      "/tiles/dem": {
        target: "https://s3.amazonaws.com",
        changeOrigin: true,
        rewrite: (path) =>
          path.replace(/^\/tiles\/dem/, "/elevation-tiles-prod/terrarium"),
      },
      "/tiles/sat": {
        target: "https://server.arcgisonline.com",
        changeOrigin: true,
        rewrite: (path) =>
          path.replace(
            /^\/tiles\/sat/,
            "/ArcGIS/rest/services/World_Imagery/MapServer/tile",
          ),
      },
    },
  },
  preview: {
    proxy: {
      "/tiles/dem": {
        target: "https://s3.amazonaws.com",
        changeOrigin: true,
        rewrite: (path) =>
          path.replace(/^\/tiles\/dem/, "/elevation-tiles-prod/terrarium"),
      },
      "/tiles/sat": {
        target: "https://server.arcgisonline.com",
        changeOrigin: true,
        rewrite: (path) =>
          path.replace(
            /^\/tiles\/sat/,
            "/ArcGIS/rest/services/World_Imagery/MapServer/tile",
          ),
      },
    },
  },
});
