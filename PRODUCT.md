# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Three kinds of visitor reach the public homepage, all confirmed by the owner: parents of junior players (often on a phone, deciding where to send a child), adult beginners, and competitive players or their parents looking for serious tournament training. Beyond the homepage, the same app serves logged-in players/parents (Player Journal) and coaches (Coach Workspace).

## Product Purpose
Sathiya Moorthy Badminton Academy (SMBA) coaches badminton in Mahadevapura, Bengaluru. One Next.js app holds the public website, the Player Journal and the Coach Workspace. For the public homepage, success is an enquiry: a visitor books the free trial, which prepares a WhatsApp message to the academy.

## Positioning
Coaching led by a BWF-certified head coach with 12+ years of experience, for all levels from beginner to advanced, where technique, movement, physical preparation and competitive thinking are developed together (claims as already published on the current homepage).

## Operating Context
The trial form on the homepage turns a visitor's answers into a WhatsApp message; the academy replies with availability and practical details; the visitor attends one free session, then chooses a program and schedule. Other contact routes are a phone number, Instagram (academy and coach) and a map link.

## Capabilities and Constraints
- Homepage is statically generated (`dynamic = "error"`) in a Next.js App Router app; styling lives in `app/public-home.css`.
- Existing sections: hero with free-trial call to action, academy and coach, programs with a fee explorer, "Why SMBA" proof points, trial form, contact.
- Stated barrier (owner's view): visitors are not sure the academy is trustworthy, including how polished it feels on a phone.

## Brand Commitments
Keep the current brand identity: the SMBA logo (`public/images/smba-logo.*`), the existing colours and the coach photograph (`public/images/coach-sathiya-court.jpeg`). The owner chose "keep the brand, refine": improve spacing, type and polish rather than replace the look.

## Evidence on Hand
Only what is already on the page: the coach photo, logo, the BWF certification and 12+ years of coaching claims. The owner has no training photos or video, no parent or player quotes and no competition results to show. Future work must not fabricate testimonials, results, student numbers or photos.

## Product Principles
- Trust is the main job of the homepage: the owner believes hesitation comes from doubt, so credibility must come from what is real.
- Never invent proof; use only evidence the academy actually has.
- One clear next step for every visitor: the free trial.
- Must work for a parent on a phone as well as an adult on a laptop.
