# SMBA Player Journal Design Context

The portal extends the public SMBA identity without copying its marketing-page layout.
It uses the same warm ivory, disciplined navy, restrained red, Manrope typography,
Newsreader editorial accents, fine borders, generous whitespace, and official logo.

The landing experience is a personal welcome. Dashboard metrics begin after the fold.
Cards remain narrative and single-purpose; navigation must not resemble admin software.
The selected Player Dashboard card system is 04A.1 Compact Match Tickets: one full-width
Next Session briefing followed by compact Attendance, Monthly Reports and Fee Record tickets.
Fine borders, clipped ticket notches, dashed mastheads and restrained red context stamps carry
the event character. Attendance, reports and fees use explicit navy-outlined action boxes as
their sole controls; reports and fees are not whole-card links. Tablet gives Attendance one
shallow full-width row, mobile stacks the same reading order, and optional Announcements follow
the primary four in a compatible full-width ticket. The card section begins directly without a
redundant visible introduction, uses one compact spacing group after the hero, then closes with
the passive Player, Level and Academy Plan ledger. Its training-week anchor lands directly below
the sticky portal header without leaving the navy hero edge or cue row behind.
Player Dashboard Announcements use one adaptive full-width Match Ticket. The masthead keeps the
total active-notice count, while the card previews no more than the pinned-first, newest-first top
two and preserves their direct detail links. A single notice receives the featured editorial
layout. Two notices share equal columns with a dashed divider on desktop and tablet, then stack on
mobile. One boxed Open all announcements action closes every populated state; in the two-notice
layout it spans the card beneath both previews with the same compact action spacing as the other
tickets. A successful zero-notice result keeps the ticket visible as the selected Quiet all-clear
state: a Clear stamp, editorial confirmation and one muted sentence,
with no icon or empty archive action. Query failure remains a separate isolated unavailable state.
The Player Fee Record uses a warm-ivory annual ledger rather than a sequence of generic finance
cards. One compact fee-season selector sits with the current balance and overall status, followed
by a compact horizontal registration truth band and a January-to-December grid. The band shows
Registration fee with its charged amount and Paid when settled, or only the outstanding amount
and Due when money remains; it omits payment date, reference, received and due-date facts. A
registration covered entirely by concession may say Covered by concession and never creates a
synthetic receipt. Desktop and tablet retain four month columns; mobile uses two without horizontal
scrolling. A month opens when it contains an issued monthly charge or receipt activity, and clicking
the open month again collapses it through year-only URL state so browser history restores both
views. Month cells never use red or green status boundaries: pale fills and text carry payment state, an underlined
month label plus semantic expanded state identifies the open month, and the small kink connecting
that month to its ledger uses only the neutral line colour. Keyboard focus uses a navy outline. Monthly-fee
facts remain charge-scoped and call their payment total Monthly fee received. Beneath them, one
chronological ledger groups all immutable receipts by the month they were actually received:
registration, monthly and combined payments share the same full-width row, each receipt appears
once at its full total with its complete public allocation breakdown, and two or three receipts
stack newest-first without an orphaned tile. Receipt-only months and years remain navigable. On
desktop and tablet the expansion stays compact through a narrow month identity and aligned fact
strip; mobile keeps its roomier stacked rhythm. Paid states are pale green, due states are pale red,
and quiet months use factual non-issued language. Partial payment never implies a refund. Only a
fully paid mid-term withdrawal becomes Closed after withdrawal with its unused-training credit
and refund; registration remains non-refundable.
The Player Journal hero keeps its oversized time-aware greeting and quiet orthographic
court, while its ivory ribbon contains only the current message from Coach Sathiya.
Next-session date, time, duration and practical details appear once, in the first dashboard
card below the hero. The message ribbon uses a balanced attribution-and-quotation layout
on desktop and tablet, then stacks the attribution above the quotation on mobile.
Player reflections belong in the physical notebook supplied in the SMBA welcome kit, so
the portal does not include a digital journal or encourage screen use during sessions.
The header has no tab navigation. One Monthly reports card on the dashboard opens a
single chronological development record rather than separate archive and detail pages.
That record uses the selected Concept 01 Season Ledger: an editorial Season record
masthead per calendar year, locally reset restrained-red folio numbers, and compact rows
whose month, publication date and disclosure control share one alignment grid. The newest
year opens by default while reports begin collapsed. Selecting a month opens only that
report's navy feedback reading panel, where the coach label, copy and outlined PDF action
share a deliberate axis across desktop, tablet and mobile.

The Player Dashboard's expanded Attendance ticket uses the selected Focused Month
Calendar rather than the former year-wide horizontal register. Annual attendance remains
the workspace context and the year selector remains visible, but one month is shown at a
time in a Monday-first seven-column calendar. Previous and next controls flank a centered,
non-interactive month-and-year label; there is no dropdown, miniature month-summary grid or
decorative rule through the toolbar. Month and year remain URL-backed for direct links,
refresh and browser history. The workspace heading uses the selected Editorial Split:
Your record and Annual attendance stay together on the left, while the year selector and
Jump to today share one vertically centered control row on desktop and tablet. Mobile stacks
the title first, a full-width year selector second, and Jump to today directly beneath it.
Jump to today restores both reference values. Every eligible same-day assignment stays a
separate status mark inside its date, rescheduled sources remain ochre, completion dates
retain the green +N notation, and the adjacent text legend remains explicit. Adjacent-month
dates may mute only their date labels; recorded attendance colours remain full strength, so
Present is the same solid green everywhere. The player calendar never scrolls horizontally
at supported widths. These player-specific session and rescheduling semantics do not change
the head-coach operational registers.

The Junior Coach's Personal Roll-Call Ledger uses the same focused-month calendar grammar
inside its existing disclosure. Keep Your record and Annual attendance, direct year controls,
Jump to today, URL-backed month navigation, the Monday-first six-week grid and the no-horizontal-
scroll responsive behavior aligned with the Player Journal. Staff attendance remains one
self-scoped, read-only daily fact rather than a session record: show solid green Present, solid
red Absent, a muted Not recorded dash and quiet striped Not available dates before joining or
after today. A cleared fact reads as Not recorded. Do not add training-group, session,
rescheduling or completion UI to the junior-coach calendar, and do not change access rules or
the compact monthly summary ticket.

The coach experience lives at `/coach` in its own route shell. Its landing screen mirrors
the student portal's calm full-height welcome rhythm: deep navy, oversized personal
greeting, subtle court linework, one ivory daily briefing card, and a quiet scroll cue.
Treat this hero as a morning briefing rather than a dashboard: its greeting, short
encouraging operational context, today's session count, first or next session time, and attendance cue answer
what the coach needs to know before stepping onto court. The encouragement stays specific
to calm leadership and readiness rather than becoming sentimental or performance-driven.
The hero remains editorial rather than analytical. Any future hero metric must
answer an immediate operational question for today; historical trends, reporting,
notifications, and general KPIs belong below the fold. It must still feel like a coach's
desk rather than administration software, so analytics grids and sidebars remain out of
scope.
Below that briefing, the seven head-coach workflows use the selected Concept 01 Court
Operations Board. One shared responsive ticket grid carries the same fine borders, clipped
notches, dashed mastheads, restrained red stamps, editorial Newsreader statements and
explicit boxed actions as the Player Journal without becoming a duplicate interface.
Attendance remains the first full-width workflow, where Player and Staff destinations stay
visibly separate, and the hero's Today's attendance cue lands at the top of this shared card
field. Player Onboarding follows immediately as the second full-width ticket, with no separate
navy divider, so it reads as another dashboard workflow rather than a detached section. It
presents exclusive New requests, Assessment, Session and Fee plan counts followed by one boxed
action. Desktop then places Sessions beside Monthly Reports, followed by equal Financials,
Announcements and Members cards. Tablet keeps Attendance, Onboarding and Sessions full width,
then pairs Monthly Reports with Financials and Announcements with Members so the lower grid has
no orphaned whitespace. Mobile stacks that same logical order. Members remains directory-only;
approval and incomplete onboarding states belong to Player Onboarding. Preserve all loaded,
empty, complete, inactive, attention, preparation and pending states, all links and report-resume
behavior.

Player Onboarding opens the selected Next-Step Register at `/coach/onboarding`. One shared
classifier produces both its four exclusive stage counts and its ordered queue: New requests,
Assessment, Session, then Fee Plan, with older waiting players first inside each stage. The page
uses one continuous ruled register with restrained red folios, factual stage stamps and one clear
next action. Exactly one player opens inline. Its accessible four-step rail and attached editor
expose only the next required operation—approval, Level/Batch/Training plan, matching recurring
session and attendance days, or agreed monthly fee and starting month. Reuse the canonical
guarded mutations, URL-backed selection, revisions, field errors, unsaved-work protection,
Academy-ID copy fallback and recovery routes for unavailable schedules or inactive Financials.
Desktop uses aligned columns and a vertical step rail; tablet keeps the editor attached below its
row; mobile uses a two-by-two count strip, compact slips, a horizontal step rail and stacked 48px
controls without horizontal scrolling. Use Training plan for the enrollment-frequency field so it
cannot be confused with the monetary Fee Plan. The all-complete state retains the same register
shell instead of removing the destination.
Focused coach player fee records continue the Academy Entry Register language rather than
returning to generic finance cards. A compact white player docket sits beside one ivory
outstanding-status cell, followed by the ruled fee-plan facts band. Receipts and charges are
separate continuous numbered registers with display-only red folios, readable supporting text
and compact aligned value cells. Mobile keeps the folio rail and reflows amounts into two
columns without horizontal scrolling. First-time creation and effective-dated plan changes use
one compact ruled docket: Level, Batch and Academy Plan stay in one facts strip, while the agreed
fee, month and action remain together at every breakpoint. Preserve fee-plan controls, concessions, immutable
receipts and refunds, payment history, corrections, downloads, archive safeguards and all
derived balance rules; density comes from shorter idle spacing, not hidden facts or smaller
interactive controls.

Monthly fees use the paired Monthly Fee Cycle Register. The selected month and record count sit
beside net monthly fees minus received equals outstanding, followed by one compact preparation
docket, the existing URL-backed filters and a continuous numbered register. Every entry keeps the
player and Academy ID, monthly fee reference or Not prepared state, due or no-charge context,
non-zero adjustments, billed, received, balance, status, archived marker and Open record action.
Desktop retains aligned columns, tablet uses the compact multi-band register row, and mobile uses
the folio rail with fee facts, three amounts and a full-width action without horizontal scrolling.
Folio numbers are display-only scan aids. Preserve preparation review and action states, month
selection, CSV export, pagination, focused-record context and ledger semantics; do not restore a
separate KPI grid or hide operational facts to make the page shorter.
Student and coach layouts stay separate in preparation for role-based login.
The Session Calendar is SMBA's operational source of truth. A recurring schedule creates
dated session occurrences. Its UUID is the immutable identity, while its Level, Batch and
time generate a consistent display name. Level plus Weekday or Weekend Batch determines
assignment eligibility; session assignments determine participation. A player may hold
multiple matching, non-overlapping assignments. Approval alone never creates attendance
eligibility. A late
assignment can expose real past occurrences from the confirmed effective date, but it
never invents sessions or automatically marks an absence. Recurring schedules generate
occurrences; historical attendance always references immutable occurrences rather than
recurrence definitions. Cancelling preserves the occurrence as history, while rescheduling
cancels the original and creates a replacement. Google Calendar is deferred as an optional
future synchronization layer and never owns rosters, eligibility or attendance.
Training Operations separates visibility, creation and assignment. Calendar opens on today
and uses the month grid only as a navigator; Day View shows dated sessions and static rosters,
keeps future cancellation and replacement, and may open the focused player recorder after a
session starts, but never edits attendance itself. Create Schedule owns recurring-session
creation. Schedules & Rosters owns existing schedules, player assignments and assignment
ending; its programme groups begin collapsed on ordinary entry, while guided evaluation may
open or create the required schedule before returning to the exact roster. Agenda and Week
views remain out of the product so each screen answers one operational question without overlap.

Academy Plan is an informational enrollment and pricing choice: Weekday 3-day, 4-day or
5-day, or Weekend plan. It does not generate sessions and never participates in attendance
calculations. During assignment, a Weekday plan must be represented by exactly 3, 4 or 5
distinct weekdays across the player's active session assignments. The first assignment
establishes that complete training week; later time-slot assignments may reuse those days but
cannot introduce an extra distinct weekday. Weekend remains flexible at one or two days.
Once saved, those effective-dated assignment weekdays—not the Academy Plan—unlock the
corresponding immutable occurrences in the attendance register. Two assigned occurrences on
the same date remain independent attendance records. Completing a player's first evaluation
leads directly into this assignment workflow so scheduling is not silently left unfinished.

Attendance remains the first coach workflow beneath the welcome. Its dashboard card separates
Player Attendance—Register, Record and Reschedule—from Staff Attendance—Register and Staff
Roll Call. Player and Staff registers retain the old-school annual colour-coded layout from
1 January through 31 December, sticky identity columns, date columns grouped by month and a
Jump to Today action, but they are read-only current-truth views rather than editors. Ordinary
player attendance is recorded only after the head coach explicitly chooses a date and one
immutable scheduled occurrence; its exact eligible roster is the sole player editing surface,
and same-day occurrences remain independent. Staff Roll Call records Present, Absent or Not
recorded once per supported junior coach and academy date without introducing shifts or staff
session assignments. Player and junior-coach personal registers remain self-scoped and
unchanged. On mobile, only date columns scroll horizontally while identity columns remain visible.

Attendance adjustments remain operationally separate from routine marking. The focused
rescheduling page retains the player, missed-session calendar, completion date, review,
publish and soft-void workflow. Record and Reschedule Attendance use the same route-header
alignment, Attendance register eyebrow, title rhythm and bordered workspace transition.
The workspace starts with a quiet New adjustment eyebrow and no redundant title or Draft
badge; during review, that same eyebrow changes to Review adjustment. The Player control
follows with the same compact operational rhythm as the attendance register controls.
The green review confirmation speaks to the coach's next action—Ready to reschedule
attendance—rather than exposing denominator or accounting mechanics.
Published adjustment links in the register deep-link to
that page without changing schedules, assignments, rosters or occurrence eligibility.

Monthly Reports shares the paired workflow row with Sessions after Player Onboarding. The card
keeps the latest completed reporting-month progress and exposes two equally weighted tasks.
Write Reports opens the focused operational workspace for drafts, resume, editing, preview
and publication. Its player queue reads as a monthly checklist and uses the same categories
as the brochure and attendance register—Beginner, Intermediate, Advanced and Adult. The
selected player and month are retained so the coach can continue where they left off. Inside
the editor, attendance is concise and read-only, and the report remains one or two human
paragraphs. Previous-month and next-month priority fields remain intentionally hidden.
Published Reports is a separate month-first, read-only archive which defaults to the latest
completed India reporting month, includes archived players' historical publications, and
never exposes drafts. Each archive row opens an immutable publication UUID, where the coach
can inspect every revision and download the exact private PDF. Draft, preview, publish and
revision editing remain exclusive to Write Reports; the archive introduces no ratings,
development bars or administrative analytics.

The selected Published Reports presentation is the Court Register. The archive begins with
a compact title and month navigator, then one count-and-search utility rail and one ordered
register rather than a stack of dashboard cards. Restrained red folios establish scanning
order while every row keeps player identity, latest revision, revision count, publication
date and separate Open report and exact PDF actions. Desktop aligns these as one continuous
ruled register; tablet combines revision and updated date while stacking the actions; mobile
uses three legible bands for identity, revision/date and two equal actions. The final register
row exposes both the visible result depth and the next ten-report reveal. Search, archived
player history, distinct empty states, URL return state and keyboard focus restoration remain
functional contracts rather than decorative variations.

Members follow Monthly reports as a third quiet dashboard entry and open a dedicated,
coach-only Member Directory. The directory is an academy record rather than a CRM:
use the selected Concept 01 Court Roster Register with one search-and-filter utility rail and one
continuous ruled register; it does not repeat registration approval or onboarding progress.
Reuse the Published Reports
language of restrained red two-digit folios so the visible roster has a stable scan order as
twelve more members are revealed. Desktop aligns combined Training, Sessions, Joined, Status
and Details columns; tablet uses two compact bands per member; mobile uses a numbered slip with
identity and status, training facts, sessions and joined date, then a full-width disclosure.
Only one member expands at a time, where profile and training data remain separate. Primary
contact information stays concealed until the coach explicitly reveals it. The selected
presentation supersedes the older mobile freeze without changing its URL state, privacy,
editing, revision, focus-restoration, assignment-lock or archival contracts. Member edits save
in place rather than redirecting into first-time session assignment. Registration
approval and the subsequent assessment, session-assignment and fee-plan stages are owned by
Player Onboarding rather than this directory. After approval, a permanent Academy ID is shared
privately and a player begins in the Unassigned state. Onboarding assigns one factual
Level—Beginner, Intermediate, Advanced or Adult—and one Batch—Weekday or Weekend. The Session
Calendar may assign multiple matching, non-overlapping sessions. A player becomes Active after
the first assignment and remains Active until the last ends. Current classification never rewrites historical
assignments, attendance or reports.
Profile, training, attendance and report records persist in one local SQLite database;
fees, medical information and hard deletion remain outside this milestone.

Public registration is player-only. Coach access is privileged and requires a future
controlled provisioning flow rather than self-selected registration. Member editing never
writes assignment-managed status, and stale edits must be rejected instead of overwriting a
newer assignment or profile change. Primary-contact information remains optional as a whole,
but partial contact records are not stored. Soft archival is available only after active
assignments end; it revokes login access while retaining the immutable account, Academy ID
allocation, attendance, reports and training history.

Account identity, authentication and player enrollment stay separate. Immutable account
UUIDs own all academy history, while Academy IDs remain human-friendly authentication
identifiers that are never edited or reused. The temporary Academy ID login stores only a
random database-backed session token in its cookie and is guarded for local prototype use.
This lets phone OTP replace the authentication method later without migrating attendance,
reports or session history. Published report revisions remain immutable and store an
append-only versioned attendance snapshot, so later attendance corrections cannot rewrite
an older report or PDF. Player downloads are generated as a distinct A4 academy letterhead.

Training language stays factual and direct. The product does not introduce foundation,
development or competitive pathways; it uses the academy's Beginner, Intermediate,
Advanced and Adult programs alongside session assignment and active status. Age groups
remain deferred until the academy defines them.

The head-coach New Announcement editor uses the selected Concept 01 Notice Slip. Keep the
Back to announcements route header compact and place one centered, fine-bordered writing slip beneath it. A small
red folded corner and quiet Notice 01 folio provide the physical notice-board character;
title and editorial message stay in the slip body, while destinations, pinning, optional
expiry and the single Review announcement action form one responsive footer docket. Keep the
same four visual bands at every supported width: a full-width Send to label, Homepage and Player
Dashboard paired on one row, Pin announcement and Expiry date paired on the next, and one
full-width Review announcement action. Mobile tightens the cells without changing that order. Do
not restore redundant Announcements, Notice board or Write an announcement headings, long
introductory copy, drafts, scheduling, audience controls or attachments. Preserve the real
checkboxes, persistent field labels, visible counters, visually hidden neutral helper copy, first-invalid focus, unsaved-work
warning, review-before-publish dialog and idempotent publication behavior.

The ordinary player attendance recorder uses the selected Ruled Attendance Ledger. Desktop
keeps the session register and a light beige-white roster in a neutral split view; tablet and
mobile attach that same roster directly below the selected navy session before later sessions
continue. Player rows use meaningful two-digit folios and full names rather than circular
initials, with explicit Present and Absent pressed-state controls and a Not marked resting
state. Present and Absent share one neutral outline and divider; selected states use pale fills
and text without green or red lower accent rules. Selecting an active choice clears it. Tablet uses two roster columns, mobile one, and
one full-width navy Save attendance action closes the ledger. Do not add a vertical red
keyline; red remains limited to editorial labels, times, folios and absent-state emphasis.
Preserve eligibility, immutable occurrence identity, rescheduling links, URL state and
unsaved-work protection.

Head-coach Staff Roll Call uses the paired Daily Staff Ledger. The compact date docket leads
directly into one beige-white ruled register with display-only two-digit folios and full junior
coach names instead of circular initials. Match the player recorder with two explicit and
joined Present and Absent pressed-state sides inside one shared neutral outline and divider, using
the same 9px desktop/tablet and 8px mobile uppercase typography. Not recorded remains the resting
persisted state rather than a third visible action: selecting the active Present or Absent box
again clears the mark. Selected boxes use restrained pale green or pale red fills and
corresponding text; do not add coloured lower accent rules. Desktop and tablet keep identity and
both controls on one compact row. Mobile keeps identity first and places two equal 48px controls
in a second band. Preserve future and pre-joining restrictions, URL-backed date selection,
unsaved-work guard, atomic save, feedback and empty-staff state.
