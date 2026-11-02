import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: "https://geofoxapps.com", changeFrequency: "monthly", priority: 1 },
    { url: "https://geofoxapps.com/support", changeFrequency: "monthly", priority: 0.7 },
  ];
}
