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
The Player Journal hero keeps its oversized time-aware greeting and quiet orthographic
court, while its ivory ribbon contains only the current message from Coach Sathiya.
Next-session date, time, duration and practical details appear once, in the first dashboard
card below the hero. The message ribbon uses a balanced attribution-and-quotation layout
on desktop and tablet, then stacks the attribution above the quotation on mobile.
Player reflections belong in the physical notebook supplied in the SMBA welcome kit, so
the portal does not include a digital journal or encourage screen use during sessions.
The header has no tab navigation. One Monthly reports card on the dashboard opens a
single chronological development record rather than separate archive and detail pages.
Reports begin collapsed with only their publication date visible. Selecting a month
opens only that report's navy feedback panel and quiet PDF action.

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
Below that briefing, the six head-coach workflows use the selected Concept 01 Court
Operations Board. One shared responsive ticket grid carries the same fine borders, clipped
notches, dashed mastheads, restrained red stamps, editorial Newsreader statements and
explicit boxed actions as the Player Journal without becoming a duplicate interface.
Attendance remains the full-width first workflow and keeps Player and Staff destinations
visibly separate. Desktop places Sessions beside Monthly Reports, followed by equal
Financials, Announcements and Members cards. Tablet keeps Attendance and Sessions full
width, then pairs Monthly Reports with Financials and Announcements with Members so the
lower grid has no orphaned whitespace. Mobile stacks that same logical order. Preserve all
loaded, empty, complete, inactive, attention, preparation and pending states, all links,
report-resume behavior and the attendance scroll target.
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

Monthly reports follow attendance as a second full-width, single-purpose card. The card
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

Members follow Monthly reports as a third quiet dashboard entry and open a dedicated,
coach-only Member Directory. The directory is an academy record rather than a CRM:
search and filters lead into one expandable member at a time, profile and training data
remain separate, active session assignments are the source of current training membership,
and initials replace inconsistent profile photos. Primary contact information stays
concealed until the coach explicitly reveals it. Pending registrations are approved here,
after which a permanent Academy ID is shared privately and a player begins in the
Unassigned state. The directory assigns one factual Level—Beginner, Intermediate, Advanced
or Adult—and one Batch—Weekday or Weekend. The Session Calendar may assign multiple
matching, non-overlapping sessions. A player becomes Active after the first assignment and
remains Active until the last ends. Current classification never rewrites historical
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
