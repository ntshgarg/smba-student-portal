import { Barlow_Condensed } from "next/font/google"

const tournamentDisplay = Barlow_Condensed({
  variable: "--font-tournament-display",
  subsets: ["latin"],
  weight: ["600", "700"],
  display: "swap",
})

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <div className={tournamentDisplay.variable}>{children}</div>
}
