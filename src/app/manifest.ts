import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AK Tracker",
    short_name: "Tracker",
    description: "私人计划、执行与反馈追踪工具",
    start_url: "/",
    display: "standalone",
    background_color: "#f3f5f1",
    theme_color: "#173f35",
    orientation: "portrait",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
