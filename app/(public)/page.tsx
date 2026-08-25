import type { Metadata } from "next"
import Image from "next/image"

import {
  ArrowRight,
  ArrowUpRight,
  Camera,
  Check,
  MapPin,
  MessageCircle,
  Phone,
} from "lucide-react"

import { absoluteSiteUrl } from "@/lib/config"
import { contact, proofPoints, trainingPrograms } from "@/lib/public/academy"
import { PublicAnnouncements } from "@/components/announcements/public-announcements"
import {
  FeeExplorer,
  FlightLineVisual,
  PrinciplesReveal,
  TrialForm,
} from "@/components/public/home-interactions"
import { Header } from "@/components/public/public-header"

const academyPrinciples = [
  "Technical excellence built through clear, repeatable habits.",
  "Competitive mentality developed with match practice and intent.",
  "Strength, mobility and flexibility supporting the whole athlete.",
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
      sameAs: [contact.coachInstagram.url],
    },
  ],
}

function SectionIntro({
  id,
  eyebrow,
  title,
  body,
  light = false,
  headingId,
}: {
  id?: string
  eyebrow: string
  title: string
  body?: string
  light?: boolean
  headingId?: string
}) {
  return (
    <div id={id} className="section-intro">
      <p className={`public-eyebrow ${light ? "public-eyebrow-light" : ""}`}>{eyebrow}</p>
      <h2 id={headingId} className={light ? "text-ivory" : ""}>{title}</h2>
      {body ? <p className={light ? "body-light" : "body-muted"}>{body}</p> : null}
    </div>
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
      <FlightLineVisual />
    </section>
  )
}

function About() {
  return (
    <section className="about section-shell" aria-labelledby="academy-title">
      <div className="about-image-wrap">
        <div className="about-image-frame">
          <Image
            src="/images/coach-sathiya.jpeg"
            alt="Coach Sathiya Moorthy"
            className="about-image"
            fill
            sizes="(max-width: 900px) calc(100vw - 32px), (max-width: 1240px) 44vw, 520px"
          />
          <div className="about-image-caption">
            <span>Sathiya Moorthy</span>
          </div>
        </div>
      </div>

      <div className="about-story">
        <SectionIntro
          id="academy"
          headingId="academy-title"
          eyebrow="The academy"
          title="Built around the player."
          body="SMBA exists to make progress deliberate. Technique, movement, physical preparation and competitive thinking are developed together—so each player understands not only what to do, but why it matters."
        />

        <PrinciplesReveal items={academyPrinciples} />

        <h3 className="public-eyebrow about-coach-label">Meet your coach</h3>
      </div>

      <div className="coach-profile">
        <blockquote className="coach-philosophy">
          <p>
            “Wherever you are starting from, you are welcome at SMBA. We’ll understand
            your game, coach with clarity, and help you grow with confidence.”
          </p>
        </blockquote>
        <p className="coach-credential">BWF-certified · 12+ years coaching</p>
        <a
          className="coach-instagram"
          href={contact.coachInstagram.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Coach Sathiya Moorthy on Instagram ${contact.coachInstagram.handle} (opens in a new tab)`}
        >
          <Camera aria-hidden="true" />
          {contact.coachInstagram.handle}
          <ArrowUpRight aria-hidden="true" />
        </a>
      </div>
    </section>
  )
}

function Programs() {
  return (
    <section className="programs section-shell" aria-labelledby="programs-title">
      <SectionIntro
        id="programs"
        headingId="programs-title"
        eyebrow="Programs"
        title="Train for what comes next."
        body="Every stage has a different job. Start with the outcome, then choose the training rhythm that fits your week."
      />

      <div className="path-grid">
        {trainingPrograms.map((program) => (
          <div className="path-card" key={program.title}>
            <div className="path-number">{program.step}</div>
            <p className="path-level">{program.level}</p>
            <h3>{program.title}</h3>
            <p className="path-description">{program.description}</p>
            <ul>
              {program.outcomes.map((outcome) => (
                <li key={outcome}>
                  <Check aria-hidden="true" />
                  {outcome}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <FeeExplorer />
    </section>
  )
}

function WhySmba() {
  return (
    <section className="why section-shell" aria-labelledby="why-smba-title">
      <SectionIntro
        id="why-smba"
        headingId="why-smba-title"
        eyebrow="Why SMBA"
        title="Evidence before promises."
        body="A premium experience is not a claim. It is the quality of attention, the clarity of the plan and the consistency of the work."
      />

      <p className="why-mobile-bridge">Here’s what you can expect at SMBA.</p>

      <div className="proof-grid">
        {proofPoints.map((point) => (
          <div className="proof-card" key={point.label}>
            <span>{point.label}</span>
            <h3>{point.title}</h3>
            <p>{point.body}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

function Trial() {
  return (
    <section id="trial" className="trial" aria-labelledby="trial-title">
      <div className="section-shell trial-inner">
        <div className="trial-copy">
          <SectionIntro
            eyebrow="Your first session"
            headingId="trial-title"
            title="Start with one focused session."
            body="Tell us where your game is today. We’ll help you take the next step."
            light
          />

          <div className="next-steps">
            <p className="public-eyebrow public-eyebrow-light">
              What happens next
            </p>
            {[
              ["Tell us about your game", "Your answers prepare a clear WhatsApp message."],
              ["Confirm a suitable session", "The academy replies with availability and practical details."],
              ["Train once, then choose", "Attend the free trial and discuss the right program and schedule."],
            ].map(([title, text], index) => (
              <div className="next-step" key={title}>
                <span>0{index + 1}</span>
                <div>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <TrialForm />
      </div>
    </section>
  )
}

function Contact() {
  return (
    <section className="contact section-shell" aria-labelledby="contact-title">
      <SectionIntro
        id="contact"
        headingId="contact-title"
        eyebrow="Contact & community"
        title="Talk to the academy."
        body="A question about levels, fees or the right place to begin? Start with a direct conversation."
      />

      <div className="contact-grid">
        <div className="instagram-card">
          <div className="instagram-card-top">
            <Camera aria-hidden="true" />
            <span>Official academy page</span>
          </div>
          <div>
            <h3>Instagram</h3>
            <p className="instagram-handle">{contact.academyInstagram.handle}</p>
            <p className="instagram-tagline">Training, progress and life inside SMBA.</p>
          </div>
          <a
            href={contact.academyInstagram.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Follow the official SMBA Instagram ${contact.academyInstagram.handle} (opens in a new tab)`}
          >
            Follow the academy
            <ArrowUpRight aria-hidden="true" />
          </a>
        </div>

        <div className="contact-stack">
          <div className="contact-card">
            <div className="contact-icon"><MessageCircle aria-hidden="true" /></div>
            <div>
              <span>WhatsApp</span>
              <a
                href={contact.whatsapp}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Message SMBA on WhatsApp at ${contact.phoneDisplay} (opens in a new tab)`}
              >
                {contact.phoneDisplay}
              </a>
            </div>
            <ArrowUpRight aria-hidden="true" />
          </div>
          <div className="contact-card">
            <div className="contact-icon"><Phone aria-hidden="true" /></div>
            <div>
              <span>Call the academy</span>
              <a href={`tel:${contact.phone}`}>{contact.phoneDisplay}</a>
            </div>
            <ArrowUpRight aria-hidden="true" />
          </div>
          <div className="contact-card">
            <div className="contact-icon"><MapPin aria-hidden="true" /></div>
            <div>
              <span>Train with us</span>
              <a
                href={contact.maps}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${contact.location} on Google Maps (opens in a new tab)`}
              >
                {contact.location}
              </a>
            </div>
            <ArrowUpRight aria-hidden="true" />
          </div>
        </div>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="footer">
      <div className="section-shell footer-main">
        <div className="footer-brand">
          <div className="footer-logo">
            <Image
              src="/images/smba-logo.png"
              alt="Sathiya Moorthy Badminton Academy"
              width={720}
              height={488}
              sizes="214px"
            />
          </div>
          <p>Professional badminton coaching in Mahadevapura, Bengaluru.</p>
        </div>

        <div className="footer-action">
          <p className="public-eyebrow public-eyebrow-light">Begin with clarity</p>
          <h2>Your next point starts here.</h2>
          <a className="button button-light" href="#trial">
            Book a free trial
            <ArrowRight aria-hidden="true" />
          </a>
        </div>
      </div>

      <div className="section-shell footer-bottom">
        <span>© {new Date().getFullYear()} Sathiya Moorthy Badminton Academy</span>
        <div>
          <a
            href={contact.academyInstagram.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="SMBA on Instagram (opens in a new tab)"
          >
            Instagram
          </a>
          <a
            href={contact.maps}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="SMBA in Mahadevapura on Google Maps (opens in a new tab)"
          >
            Mahadevapura
          </a>
          <a href="#top">Back to top</a>
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
        <About />
        <Programs />
        <WhySmba />
        <PublicAnnouncements />
        <Trial />
        <Contact />
      </main>
      <Footer />
    </div>
  )
}
