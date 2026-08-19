# SMBA production acceptance record

Complete this record with the head coach, one junior coach and two or three consenting test players
before importing the full academy roster. Use test financial amounts and reverse them after verification.

## Run details

- Date:
- Release commit:
- Platform owner:
- Head coach:
- Junior coach:
- Devices: desktop / tablet / phone
- Production snapshot or Turso recovery point confirmed at:

Do not write passwords, PINs, email codes, recovery links, authenticator secrets or backup codes here.

## Acceptance checks

| Area | Required production result | Result | Evidence or issue |
| --- | --- | --- | --- |
| Head-coach access | Password, PIN and authenticator setup complete; fresh login succeeds | ☐ Pass ☐ Fail | |
| Junior-coach onboarding | Request, approval, email verification and activation succeed | ☐ Pass ☐ Fail | |
| Player onboarding | Two or three requests move through approval, assessment, session and fee plan | ☐ Pass ☐ Fail | |
| Permissions | Player sees only own data; junior coach cannot use head-coach-only operations | ☐ Pass ☐ Fail | |
| Sessions | Create a session and see the same occurrence in calendar, roster and dashboards | ☐ Pass ☐ Fail | |
| Attendance | Record player attendance and staff roll call; correct one deliberate mistake | ☐ Pass ☐ Fail | |
| Fees | Record one registration and one monthly offline payment; verify both portals | ☐ Pass ☐ Fail | |
| Announcements | Publish and withdraw one test announcement; verify intended audience | ☐ Pass ☐ Fail | |
| Reports | Publish one monthly report; verify the correct player can read it | ☐ Pass ☐ Fail | |
| Player recovery | Verified-email password recovery succeeds and old sessions/PIN are revoked | ☐ Pass ☐ Fail | |
| Head-coach recovery | Protected recovery succeeds with authenticator or backup code | ☐ Pass ☐ Fail | |
| Responsive use | Principal workflows remain usable on phone, tablet and desktop | ☐ Pass ☐ Fail | |
| Monitoring | Health, security-signal and deployment monitors are green | ☐ Pass ☐ Fail | |
| Recovery | A fresh encrypted backup exists and the recorded restore drill passed | ☐ Pass ☐ Fail | |

## Go-live decision

- ☐ Go: every required check passed and no unresolved P0/P1 issue remains.
- ☐ Conditional go: only documented P2/P3 issues remain, with an owner and deadline.
- ☐ No-go: stop roster import and resolve the failures first.

Decision owner:

Date:

Open issues and owners:
