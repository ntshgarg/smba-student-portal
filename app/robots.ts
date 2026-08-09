import type { MetadataRoute } from "next"

import { absoluteSiteUrl } from "@/lib/config"

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/coach",
        "/player",
        "/login",
        "/register",
        "/reports",
        "/progress",
      ],
    },
    sitemap: absoluteSiteUrl("/sitemap.xml"),
    host: absoluteSiteUrl("/"),
  }
}
