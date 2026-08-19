# SMBA privacy and record-retention policy

Status: **Ready for academy and legal sign-off**

Policy owner: Sathiya Moorthy Badminton Academy (SMBA)

Security contact: `security@smbaacademy.in`

Review interval: every 12 months and after any material incident or provider change

This operational policy describes how SMBA uses its academy portal. It should be reviewed by an
appropriately qualified Indian adviser before the full student roster is entered. The Digital Personal
Data Protection Act, 2023 and Rules, 2025 have phased commencement dates; SMBA adopts the safeguards
below as its operating baseline before every provision becomes applicable.

## Purpose and data collected

SMBA uses the minimum information needed to administer membership, coaching and account security:

- member and coach identity, Academy ID, level, batch, programme and session assignments;
- attendance, make-up attendance and monthly coaching reports;
- fee plans, concessions, offline-payment records, refunds and financial audit history;
- announcements and their intended audiences;
- recovery email, password/PIN hashes, authenticator material, active sessions and security events; and
- sanitized application-error fingerprints and route templates. Exception text and request content are
  not stored in the operational error table.

SMBA does not use portal data for advertising, behavioural profiling or sale. Card and bank credentials,
email codes, passwords, PINs, authenticator secrets and backup codes must never be placed in notes.

## Roles and access

- The head coach controls academy operations and approves new accounts.
- Junior coaches receive only their assigned operational permissions.
- Players receive access only to their own records.
- The platform owner may preview dashboards and perform the narrowly documented security-support actions;
  ordinary academy records remain read-only to that role.
- Hosting, database and authentication-email providers process data only to operate the portal.

Every person uses an individual account. Access is revoked promptly when a role ends. Active sessions are
reviewed monthly and after any suspected compromise.

## Children and guardians

Before approving an account for anyone under 18, the head coach must verify the parent or lawful guardian
and record the academy's consent acknowledgement outside the portal until a dedicated consent record is
implemented. A guardian may supply the recovery email, and siblings may share that address. SMBA will not
track children for advertising or undertake processing likely to harm their well-being.

## Access, correction and deletion requests

A player or guardian may contact the security address to request access, correction or deletion. The head
coach verifies the requester's identity before acting. Corrections use the portal's normal effective-dated
or reversal workflows so attendance and financial history are not silently rewritten. A deletion request
is completed unless a record must be retained for legal, accounting, dispute or security purposes; any
retained exception is documented with its reason and review date.

## Retention schedule

| Record | Retention baseline | End-of-period action |
| --- | --- | --- |
| Rejected or abandoned registration request | 90 days after final decision/activity | Delete or irreversibly anonymize |
| Active member/coach profile and assignments | While the account is active | Review when membership or employment ends |
| Archived identity, attendance and coaching reports | 3 years after the end of membership | Delete or anonymize unless a documented dispute requires more time |
| Charges, payments, concessions, refunds and financial audit history | 8 financial years after the relevant financial year | Confirm with the academy's accountant, then securely delete |
| Expired/withdrawn announcements | 1 year after expiry or withdrawal | Delete |
| Authentication security events | 180 days | Delete unless attached to an open incident |
| Sanitized application-error events | 90 days | Delete after operational review |
| Expired email challenges, sessions and rate-limit records | No more than 90 days after expiry | Delete |
| Verified recovery email | While the account remains recoverable | Remove after account closure and required record reconciliation |
| Encrypted logical backups | 35 days | Automatic artifact expiry; verify at least four recent backups exist |
| Turso point-in-time recovery | Provider-plan window | Let the provider expire it automatically |
| Security incident record | 3 years after closure | Review, then securely delete |

The head coach and platform owner review this schedule quarterly. Extending a period requires a recorded
reason, owner and deletion review date. Shortening financial retention requires the academy accountant's
written confirmation.

## Security and providers

- Production changes pass the protected GitHub regression gate before merge.
- Vercel hosts the application, Turso stores the database, Resend sends authentication email, and GitHub
  retains only encrypted scheduled backups.
- Production health and security signals are monitored; operational alerts contain counts and links, not
  personal details.
- Backups are encrypted before upload. The passphrase is stored separately from GitHub and production
  credentials.
- Suspected incidents follow `docs/PRODUCTION-OPERATIONS.md`; affected sessions and secrets are revoked
  before normal operation resumes.

## Approval

Academy owner/head coach: ____________________  Date: __________

Platform owner: ______________________________  Date: __________

Legal/accounting review, if applicable: _______  Date: __________
