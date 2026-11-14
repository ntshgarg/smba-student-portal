import type { Metadata } from "next"
import Image from "next/image"

import {
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  Camera,
  MapPin,
  MessageCircle,
  Phone,
} from "lucide-react"

import { absoluteSiteUrl } from "@/lib/config"
import { contact } from "@/lib/public/academy"
import { navItems } from "@/lib/public/navigation"
import { PublicAnnouncements } from "@/components/announcements/public-announcements"
import { HeroShuttle } from "@/components/public/hero-shuttle/hero-shuttle"
import {
  ProgramPlanner,
  TrialForm,
} from "@/components/public/home-interactions"
import { Header } from "@/components/public/public-header"

const trainingPillars = [
  ["Technique", "Technical excellence built through clear, repeatable habits."],
  ["Match mindset", "Competitive mentality developed through match practice and intent."],
  ["Strength & mobility", "Strength, mobility and flexibility are part of the training, not an afterthought."],
  ["Structured feedback", "Each player’s progress is tracked through assessment reports."],
] as const

const coachFacts = [
  ["12+", "years coaching"],
  ["BWF", "certified coach"],
  ["All", "levels coached"],
] as const

export const metadata: Metadata = {
  alternates: {
    canonical: "/",
  },
}

export const dynamic = "error"


const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SportsActivityLocation",
      "@id": absoluteSiteUrl("/#academy-location"),
      name: "Sathiya Moorthy Badminton Academy",
      alternateName: "SMBA",
      description:
        "Professional badminton coaching for beginner, intermediate, advanced and adult players in Mahadevapura, Bengaluru.",
      url: absoluteSiteUrl("/"),
      logo: absoluteSiteUrl("/images/smba-logo.jpeg"),
      image: absoluteSiteUrl("/og.png"),
      telephone: contact.phone,
      address: {
        "@type": "PostalAddress",
        addressLocality: "Mahadevapura",
        addressRegion: "Karnataka",
        addressCountry: "IN",
      },
      hasMap: contact.maps,
      sameAs: [contact.academyInstagram.url],
    },
    {
      "@type": "Person",
      "@id": absoluteSiteUrl("/#head-coach"),
      name: "Sathiya Moorthy",
      jobTitle: "Head Coach",
      worksFor: {
        "@id": absoluteSiteUrl("/#academy-location"),
      },
      image: absoluteSiteUrl("/images/coach-sathiya-court.jpeg"),
      sameAs: [contact.coachInstagram.url],
    },
    {
      "@type": "WebSite",
      "@id": absoluteSiteUrl("/#website"),
      url: absoluteSiteUrl("/"),
      name: "Sathiya Moorthy Badminton Academy",
      alternateName: "SMBA",
      inLanguage: "en-IN",
      publisher: {
        "@id": absoluteSiteUrl("/#academy-location"),
      },
    },
  ],
}

function SectionIntro({
  id,
  eyebrow,
  title,
  body,
  headingId,
}: {
  id?: string
  eyebrow: string
  title: string
  body?: string
  headingId?: string
}) {
  return (
    <div id={id} className="section-intro">
      <p className="public-eyebrow">{eyebrow}</p>
      <h2 id={headingId}>{title}</h2>
      {body ? <p className="body-muted">{body}</p> : null}
    </div>
  )
}

/** Numbered glass cards, each big red number half behind its pane: How we train's pillars, and the steps
 * after a trial request. */
function NumberedCards({
  className,
  items,
  label,
}: {
  className: string
  items: readonly (readonly [title: string, text: string])[]
  label?: string
}) {
  return (
    <ol className={className} aria-label={label}>
      {items.map(([title, text], index) => (
        <li key={title}>
          <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
          <h3>{title}</h3>
          <p>{text}</p>
        </li>
      ))}
    </ol>
  )
}

function Hero() {
  return (
    <section id="top" className="hero" aria-labelledby="hero-title">
      <div className="hero-copy">
        <p className="public-eyebrow">
          Sathiya Moorthy Badminton Academy · Mahadevapura
        </p>
        <h1 id="hero-title">
          The work behind
          <br />
          every <em>point.</em>
        </h1>
        <p className="hero-support">
          Technical development, physical preparation and competitive mindset—
          brought together in every focused session.
        </p>
        <div className="hero-actions">
          <a className="button button-primary" href="#trial">
            Book a free trial
            <ArrowRight aria-hidden="true" />
          </a>
          <a className="button button-secondary" href="#programs">
            Find your program
          </a>
        </div>
        <div className="hero-trust">
          <span>
            <strong>BWF</strong>
            <small>Certified head coach</small>
          </span>
          <span>
            <strong>12+</strong>
            <small>Years of coaching</small>
          </span>
          <span>
            <strong>All levels</strong>
            <small>Beginner to advanced</small>
          </span>
        </div>
      </div>
      <HeroShuttle />
    </section>
  )
}

/**
 * Everything about the coach in one place: his photo, then who he is on a clear glass card that overlaps
 * the photo's edge. On a phone the card slides up over the photo.
 */
function Coach() {
  return (
    <section id="coach" className="coach" aria-labelledby="coach-title">
      <figure className="coach-photo">
        <Image
          src="/images/coach-sathiya-court.jpeg"
          alt="Coach Sathiya Moorthy"
          fill
          sizes="(max-width: 900px) 100vw, 54vw"
        />
      </figure>

      <div className="coach-panel">
        <p className="public-eyebrow">Your coach</p>
        <h2 id="coach-title">
          <span>Sathiya</span> <span>Moorthy</span>
        </h2>
        <p className="coach-lead">
          Head coach at SMBA, developing players from their first session to state, national and
          international competition.
        </p>
        <blockquote className="coach-quote">
          <p>
            “Wherever you are starting from, you are welcome at SMBA. We’ll understand your game,
            coach with clarity, and help you grow with confidence.”
          </p>
        </blockquote>
        <ul className="coach-facts">
          {coachFacts.map(([figure, label]) => (
            <li key={label}>
              <strong>{figure}</strong> {label}
            </li>
          ))}
        </ul>
        <a
          className="coach-instagram"
          href={contact.coachInstagram.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Coach Sathiya Moorthy on Instagram ${contact.coachInstagram.handle} (opens in a new tab)`}
        >
          <span>
            <Camera aria-hidden="true" />
            {contact.coachInstagram.handle}
          </span>
          <ArrowUpRight aria-hidden="true" />
        </a>
      </div>
    </section>
  )
}

/** How SMBA trains: the academy's four pillars, each said once. */
function Training() {
  return (
    <section className="training section-shell" aria-labelledby="training-title">
      <SectionIntro
        id="training"
        headingId="training-title"
        eyebrow="How we train"
        title="Built around the player."
        body="Technique, movement, physical preparation and competitive thinking are developed together, so every player understands not only what to do, but why it matters."
      />

      <NumberedCards className="training-pillars" items={trainingPillars} />
    </section>
  )
}

/** Programs and their fees as one choice: a level, then a plan for it. */
function Programs() {
  return (
    <section className="programs section-shell" aria-labelledby="programs-title">
      <SectionIntro
        id="programs"
        headingId="programs-title"
        eyebrow="Programs & fees"
        title="Train for what comes next."
        body="Every stage has a different job. Start with the outcome, then choose the training rhythm that fits your week."
      />

      <ProgramPlanner />
    </section>
  )
}

const trialSteps = [
  ["Tell us about your game", "Your answers prepare a clear WhatsApp message."],
  ["Confirm a suitable session", "The academy replies with availability and practical details."],
  ["Train once, then choose", "Attend the free trial and discuss the right program and schedule."],
] as const

// Each link is named by its visible words (label, value, action), so voice control can say them
const reachLinks = [
  {
    icon: MessageCircle,
    label: "WhatsApp",
    value: contact.phoneDisplay,
    action: "Message",
    href: contact.whatsapp,
  },
  { icon: Phone, label: "Call", value: contact.phoneDisplay, action: "Call now", href: `tel:${contact.phone}` },
  { icon: MapPin, label: "Visit", value: contact.venue, action: "Open in Maps", href: contact.maps },
  {
    icon: Camera,
    label: "Instagram",
    value: contact.academyInstagram.handle,
    action: "Follow",
    href: contact.academyInstagram.url,
  },
] as const

/** The free trial: what happens after you ask, then the request itself. */
function StartHere() {
  return (
    <section id="trial" className="start section-shell" aria-labelledby="trial-title">
      <SectionIntro
        eyebrow="Your first session"
        headingId="trial-title"
        title="Start with one focused session."
        body="Tell us where your game is today. We’ll help you take the next step."
      />

      <div className="start-grid">
        <NumberedCards className="start-steps" items={trialSteps} label="What happens next" />

        <TrialForm />
      </div>
    </section>
  )
}

/* The page ends on one pane of glass: the direct ways to reach the academy, then its mark, the same menu as
   the header, and the way back up */
function Footer() {
  return (
    <footer id="contact" className="footer section-shell" aria-labelledby="contact-title">
      <div className="footer-panel">
        <h2 id="contact-title" className="public-eyebrow">Talk to the academy</h2>
        <ul className="footer-reach">
          {reachLinks.map(({ icon: Icon, label, value, action, href }) => {
            const external = href.startsWith("http")
            return (
              <li key={label}>
                <span className="footer-reach-mark" aria-hidden="true"><Icon /></span>
                <a href={href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
                  <small>{label}</small>
                  <strong>{value}</strong>
                  <span className="footer-reach-go">
                    {action}
                    <ArrowUpRight aria-hidden="true" />
                  </span>
                  {external ? <span className="sr-only"> (opens in a new tab)</span> : null}
                </a>
              </li>
            )
          })}
        </ul>

        <div className="footer-bar">
          <Image
            className="footer-logo"
            src="/images/smba-logo.png"
            alt="Sathiya Moorthy Badminton Academy"
            width={720}
            height={488}
            sizes="96px"
          />
          <nav className="footer-nav" aria-label="Footer">
            {navItems.map((item) => (
              <a key={item.href} href={item.href}>
                {item.label}
              </a>
            ))}
          </nav>
          <div className="footer-end">
            <small>© {new Date().getFullYear()} Sathiya Moorthy Badminton Academy</small>
            <a href="#top">
              Back to top
              <ArrowUp aria-hidden="true" />
            </a>
          </div>
        </div>
      </div>
    </footer>
  )
}

export default function Home() {
  return (
    <div className="public-home">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <Header />
      <main id="main-content" tabIndex={-1}>
        <Hero />
        <Coach />
        <Training />
        <Programs />
        <StartHere />
        <PublicAnnouncements />
      </main>
      <Footer />
    </div>
  )
}
