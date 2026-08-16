import type { Metadata, Viewport } from "next"
import { Manrope, Newsreader } from "next/font/google"
import { siteOrigin } from "@/lib/config"
import "./globals.css"

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  display: "swap",
})

const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  style: ["normal", "italic"],
  display: "swap",
})

export const metadata: Metadata = {
  metadataBase: siteOrigin,
  title: {
    default: "SMBA | Professional Badminton Coaching in Mahadevapura",
    template: "%s | SMBA",
  },
  description:
    "BWF-certified badminton coaching for beginner, intermediate, advanced and adult players at Just Play, Mahadevapura, Bengaluru.",
  keywords: [
    "badminton academy Mahadevapura",
    "badminton coaching Bengaluru",
    "SMBA",
    "Sathiya Moorthy badminton",
    "badminton free trial",
  ],
  authors: [{ name: "Sathiya Moorthy Badminton Academy" }],
  creator: "Sathiya Moorthy Badminton Academy",
  icons: {
    icon: [{ url: "/images/smba-logo.jpeg", type: "image/jpeg" }],
    apple: [{ url: "/images/smba-logo.jpeg", type: "image/jpeg" }],
  },
  openGraph: {
    type: "website",
    url: "/",
    locale: "en_IN",
    siteName: "Sathiya Moorthy Badminton Academy",
    title: "The work behind every point. | SMBA",
    description:
      "Technical development, physical preparation and competitive mindset—brought together in focused training.",
    images: [{
      url: "/og.png",
      width: 1200,
      height: 630,
      alt: "SMBA — The work behind every point.",
    }],
  },
  twitter: {
    card: "summary_large_image",
    title: "The work behind every point. | SMBA",
    description: "Professional badminton coaching in Mahadevapura, Bengaluru.",
    images: ["/og.png"],
  },
}

export const viewport: Viewport = {
  themeColor: "#071b32",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${manrope.variable} ${newsreader.variable}`}>
        {children}
      </body>
    </html>
  )
}
