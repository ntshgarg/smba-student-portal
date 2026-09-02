# Registration flow — adversarial break test

Six attack lenses (enumeration, identity-key, atomicity, validation, rate-limit, auth-boundary) ran
against `feat/email-verified-registration`. Every claim was then handed to an independent verifier
whose default posture was *"this is wrong or overstated — reproduce it or reject it."* Everything
below reproduced against an in-memory SQLite database with the real `drizzle` migrations, driving
the real service functions. Scratch test files were deleted; nothing outside this document remains.

24 claims were verified. **7 survived as real defects.** The rest were downgraded to `minor` or
`note`, and are listed at the end so they are not re-discovered from scratch.

**All seven are fixed** (`637d348`, `b9be603`, `074961e`, `664103f`), each pinned by a regression in
`tests/registration-attack-regressions.test.ts` that fails against the code as it stood.

A second sweep then attacked the fixes themselves, and found that two of them made things worse.
See **Round two** below — `074961e` in particular is superseded by `a299df2` and should not be read
as the current design.

---

## 1 · Archiving a member permanently bricks their identity — `blocker`

*Found independently by five of the six lenses. The only finding that produces a 500.*

`registrationStandingFor` treats an archived account as absent — deliberately, so archiving cannot
be used to probe whether someone was ever registered:

```ts
// lib/auth/account-service.ts:139
if (!existing || existing.archivedAt) return null
```

But the partial unique index has no matching exemption:

```sql
-- drizzle/0032_registration_identity.sql
CREATE UNIQUE INDEX accounts_registration_identity_key_idx
  ON accounts (registration_identity_key)
  WHERE "accounts"."registration_identity_key" is not null;
```

So `confirmRegistration` takes the *create* branch and the INSERT collides with the archived row's
key. The throw is a raw `SqliteError`, not an `OperationalActionError`, and
[app/login/actions.ts:356](app/login/actions.ts:356) has no try/catch — it reaches the Next error
boundary as a 500.

```
round 1  standing: new / threw: UNIQUE constraint failed: accounts.registration_identity_key
round 2  standing: new / threw: UNIQUE constraint failed: accounts.registration_identity_key
round 3  standing: new / threw: UNIQUE constraint failed: accounts.registration_identity_key
accounts: 1   challenges consumed: yes,yes,yes,no
```

The transaction rolls back, so the challenge is left unconsumed and **every retry fails
identically, forever**. The client catches the rejection and renders *"We couldn't send your
request… please try again"*, so the loop is silent. The status door doesn't crash (it is read-only)
but reports the archived person as `standing: "new"` with a *Request registration* link that leads
straight back into the crash.

**Fix:** null `registrationIdentityKey` inside the archive transaction
([lib/coach/member-service.ts:432](lib/coach/member-service.ts:432)) so the key is released when
the membership ends. This keeps the "archiving is not an oracle" property with no index change.
Independently, wrap the `confirmRegistration` call so an unexpected database error becomes a form
message rather than a 500.

---

## 2 · Invisible characters survive name normalization — `major`

`normalizedNameKey` runs `\s+` collapse and NFKC, and neither removes format characters. Brute
force over every code point found **exactly 25 characters vanish from the key, and all 25 are
whitespace**. ZWSP, SOFT HYPHEN, ZWNJ, U+180E, RLO and WORD JOINER all survive.

```
register("Arjun Sharma")           -> account A
register("Arjun​ Sharma")     -> account B   (renders identically)
```

Both names also reach `fullName` and `normalized_name` — the column the finance and report lists
sort on and the CSV exports carry. And a rejected applicant re-enters the pending queue as a
stranger.

**Fix:** strip `\p{Cf}`/`\p{Cc}` in `normalizeFullName` so the display name is clean too, and widen
`tests/property/normalization-csv.property.test.ts` to draw from `fc.fullUnicodeString()` — it
currently defaults to printable ASCII, which is why it passes while the property is false.

---

## 3 · A coach renaming a member strands their identity key — `major`

`updateMemberRecord` ([lib/coach/member-service.ts:355](lib/coach/member-service.ts:355)) writes
`fullName` and `normalizedName` and never touches `registrationIdentityKey`. Nothing anywhere
recomputes it.

```
after rename:            { fullName: 'Arjun Sharmaa', keyUnchanged: true }
status(corrected name):  { standing: 'new' }            <- their own lookup denies them
status(original name):   { standing: 'approved', … }
duplicate registration:  { accountId: 'b25871c5…', standing: 'new' }
accounts for this email: two rows, both 'Arjun Sharmaa' — one approved, one pending
```

The rename is UI-reachable from the member edit form. So a coach fixing a typo hands that person a
status page that says nothing is on file, and the only button on it creates the duplicate the whole
feature exists to prevent.

**Fix:** recompute the key in the same transaction as the rename, catching the unique-index
violation as a `CONFLICT`. Ideally keep the superseded key resolvable via an alias table so
someone who types the name they originally registered with still finds their request.

---

## 4 · The send throttle is keyed on a name the attacker chooses — `major`

`registrationSubjectKey(normalizedEmail, normalizedName)` mixes free-form attacker text into the
throttle subject, and both the 5-per-15-min counter and the 60s cooldown hang off it.

```
fixed name,  rotated IPs, one instant :  1 delivered, 29 refused
fixed name,  rotated IPs, 61s apart   :  5 delivered,  9 refused
name varied, one IP,      one instant : 20 delivered, 40 refused   (per-IP is the only ceiling)
name varied, rotated IPs, one instant : 60 delivered,  0 refused
```

All sixty land in **one inbox**, from the academy's own sender. IP rotation alone buys nothing —
the name variation is the load-bearing bypass.

**Fix:** scope the send throttle and the resend cooldown to the *address*, and keep the
name-inclusive subject key only for challenge dedup, where it is actually needed.

---

## 5 · Anyone who knows a name and email can lock that person out — `major`

Same root cause, opposite direction. The send budget is keyed on the victim's identity, so any
requester from any IP spends it:

```
attacker (5 sends, 60s apart, one IP) -> victim refused on BOTH registration and status lookup
adaptive attacker, victim probing every 5s for 40 min: 0 successes in 480 probes
  (360 refused by the identity block, 120 by the identity-wide resend cooldown)
cost to attacker: ~18 sends/hour on one IP — under the per-IP threshold of 20 per 15 min
```

The block gaps are sealed by the resend cooldown, so the victim's window is a sub-second race. It
covers the status lookup too, which means the "check from any device" escape hatch added in
`c341d0c` is blocked by the same attack.

A related confirm-side variant (verifier: **overstated → still real**): five forged wrong codes from
a stranger consume the victim's challenge *and* trip the confirm bucket, so the code sitting in the
victim's inbox stops working and so does its replacement.

**Fix:** split "may this requester ask" from "may we mail this identity again". Meter refusals per
requester; keep an identity-scoped cap only on mail actually *delivered*, and when the identity
budget is spent but a live challenge already exists, return the same accepted response without
sending — the honest victim is then told to check their inbox rather than refused. Add an *"I
already have a code"* entry to both forms so a live challenge is redeemable without a send.

---

## 6 · The identity key is not idempotent — `minor`

Whitespace collapse runs *before* NFKC, and NFKC can **introduce** spaces (compatibility
decompositions of spacing diacritics: `U+00A8` → `U+0020 U+0308`). Any space NFKC creates is never
collapsed.

```
registrationIdentity("Anaïs ¨ Rao", …).normalizedName === "anaïs  ̈ rao"   (double space)
feeding that back                                     === "anaïs ̈ rao"    (single)
subjectKey  registration:4340…  vs  registration:be7bb0…   -> not idempotent
```

`tests/registration-identity-key.test.ts:55` asserts idempotence and passes, because it uses
`" Arjun   Sharma "` — ASCII.

**Fix:** normalize first, then trim and collapse. Stop routing the key through `normalizeFullName`,
which must keep collapse-only behaviour for the display name.

---

## 7 · The onboarding gate is on one door only — `minor`

The status door mints an activation claim only when `approved && onboardingCompleted`. The
registration door mints one at registration time — before approval, before `playerEnrollments`
exists — and `approveRegistration` then extends it for another 30 days. So the comment at
[account-service.ts:411](lib/auth/account-service.ts:411) asserting *"a player may only set a
password once the coach has finished onboarding them"* describes a rule only one of the two doors
enforces.

**Fix:** pick one rule and state it in both places. Either drop `&& onboardingCompleted` from the
status door, or join `playerEnrollments` in `completeAccountActivation` so the rule is real.

---

## What held up under attack

Worth recording, because these are the properties the design was actually built for:

- **Enumeration symmetry is solid.** Registered and unknown identities returned byte-identical
  JSON, spent identical throttle budget, sent exactly one email each, and landed at 111ms vs 134ms —
  both inside the 100–150ms floor. The standing travels only in the mail body.
- **Nothing is written before a code is confirmed.** No path found writes an `accounts` row early,
  including after a mail-delivery failure.
- **Replay and double-spend hold.** Confirming the same code twice gives one account row and zero
  unconsumed challenges. Two live challenges for one identity are not constructible — the supersede
  and the insert share one `behavior: "immediate"` transaction with no async boundary between them.
- **The identity-key separator cannot be slid.** The email regex forbids every whitespace character
  NFKC can produce, and it runs *after* NFKC, so `("ab","c@d.ee")` and `("a","bc@d.ee")` cannot be
  made to collide. The 80-char cap is a rejection, not a truncation.
- **Role coercion fails.** `requestedRole` cannot be forced to `platform_admin`.
- **A pending account cannot authenticate.** No usable claim could be minted for a rejected,
  archived, or already-activated account, including with a resurrected claim row.
- **The two flows share one budget, as intended** — five status sends exhaust it and the sixth
  *registration* send is refused. The limit is not accidentally doubled.
- **Send-side ordering is correct.** A request refused by the cooldown does not consume send
  budget, and a blocked request cannot extend its own block.

## Downgraded on verification

Reproduced but judged `minor` or `note`. Not fixed, not forgotten:

| Claim | Verdict |
| --- | --- |
| Registration sends drain the same per-IP bucket as password sign-in (`ip:` key is unnamespaced) | real; 20 sends behind one NAT block login for 15 min |
| Throttle refusals skip the timing floor — 143ms accepted vs 1.0ms refused, three distinguishable messages | real activity oracle, needs a guessed name+email |
| Confirm spends budget only when a challenge exists — free probe for "is this identity mid-registration" | weak oracle; the lockout half is covered in §5 |
| A failed mailer destroys the previously working code (supersede commits, rollback is not a restore) | real, narrow |
| The status flow burns a registration challenge and writes nothing | shared `verify_email` pool; "consumed iff created" was never the invariant |
| `requestedRole`, phone and DOB are re-supplied at confirm, not bound to the emailed code | you can only rewrite your own pending request |
| A step-two validation failure is reported as *"That code is invalid or expired."* | reachable at the 120-year DOB boundary |
| `normalizeEmailAddress` accepts C0 control characters including NUL | stored and mailed to |
| NFKC contraction defeats the 80-character cap — a 240-character name is stored | display only |
| DOB validated against the Asia/Kolkata date | a birth date that is "today" abroad is refused with no explanation |
| A rejected identity can never re-apply, and is told so on an unauthenticated screen | policy question, not a defect |
| A status-form code is accepted by the registration form | same subject key by design |
| A person registered in one role has their request for the other role silently swallowed | |
| Status lookup re-mints the activation claim, clobbering an outstanding receipt | mechanically real, no privilege gained |
| `auth_email_challenges` and `auth_login_attempts` grow without bound | nothing prunes |
| A client-supplied `x-forwarded-for` picks the rate-limit bucket when no platform header is present | not reachable on Vercel |


---

# Round two — attacking the fixes

The seven fixes above were handed to the same treatment: five lenses over HEAD, each finding
verified by someone told to reject it. Three of the fixes were wrong.

## The per-IP bucket was halved, not namespaced — `major`, confirmed twice

`requestThrottleKeys` passed the caller's raw address hash through, and `attemptKeys` writes
`ip:<hash>` from whatever it is handed — the same row the sign-in paths read. So every
unauthenticated recovery and registration request was already spending the twenty-per-fifteen-minutes
budget that decides whether anyone behind that address can sign in. `074961e` added a *second*
`recordLoginFailure`, making one send cost two of those twenty.

```
first send that blocked the IP: 10
ip row after 12 sends: failedCount=20 blockedUntil=…
```

Ten sends from an academy's wifi or a carrier NAT locked out every unrelated person on it. Fixed in
`a299df2` by namespacing the address half, which also closes the pre-existing shared-bucket finding
listed as downgraded above.

## The per-address ceiling was a worse lock than the one it replaced — `major`

```
5 junk-name sends, one IP        -> victim refused on BOTH doors, 15 min, renewable forever
victim probes, 45 simulated min  -> 2 codes in 16 attempts, attacker cost 8 of 20 ip slots
codes that landed                -> bound to the junk identities; victim's confirm returns null
no attacker at all               -> 3 children + 2 resends = 5 sends, the 6th silently dropped
```

The comment asserting *"neither is spendable by a stranger on the victim's behalf"* was false for the
delivery ceiling, and the one promising the victim a *"still-valid code already sitting"* in their
inbox was false for anyone the attacker named differently.

This is not a threshold that needed raising. Any ceiling counting sends to an address is spendable by
whoever generates the volume, so it is always a lock on whoever owns that address. `a299df2` removes
it. What bounds a flood now is the cooldown, scoped to the address rather than the identity: one code
per inbox per minute, however many names and origins try. Between an inbox that can be flooded and a
family that cannot register a child, the flood is the lesser harm — and the form says a code can take
a minute, unconditionally, so the wait is explained without admitting who is registered.

## Stripping format characters rewrote Indic names — `major`

`ഗോപാല്‍` became `ഗോപാല്` and `क्‌षमा` became `क्षमा` — in the *stored and displayed* name, not just the
key. ZWJ and ZWNJ are letters' business in these scripts: `<consonant, virama, ZWJ>` is how Malayalam
writes a chillu. And the fix missed its own goal, because the ZWJ chillu and the atomic chillu render
identically, NFKC does not unify them, and they still hashed apart.

`a26ed79` enumerates the invisible set instead of taking a Unicode category wholesale, keeps both
joiners in the display name, folds them plus the six Malayalam chillu sequences in the key, and is
verified idempotent across 13,575 samples.

## Also fixed

- **The status door offered a password form to an account that already had one** (`73d7e40`),
  resurrecting its consumed claim and overwriting the token hash the original browser held.
- **CI could never have run the registration E2E** (`62ad894`): the memory mail transport is gated on
  a named rig profile and a rig-named database, and the job set neither, so `/register` dead-ended on
  *"Authentication email delivery is temporarily unavailable."*
- **The E2E suite drove a flow that no longer exists** (`92441ef`): all six tests failed against a
  production build. `b491b51` repointed the button labels and nobody ran it.

## Verified green after round two

Registration 6/6, authentication 5/5, onboarding 1/1, both accessibility profiles (clean at 0
advisories, admin at its recorded 147), 1362 unit tests, `tsc` and `eslint`.

## Still open

- **The timing channel survives.** A delivered send is floor-plus-delivery (~208ms observed); a
  suppressed one is the floor alone (~128ms). One timed request still separates "a code went out"
  from "suppressed". Closing it means taking mail off the request path.
- **A rejected registration can never be un-rejected**, and the identity key stays on the rejected
  row, so a mis-click on Reject is unrecoverable through the product.
- **A distributed flood is bounded only by the address cooldown** — 15 codes per inbox per 15
  minutes. Below that needs bot detection at the edge, which the plan listed as optional.
- The rest of the downgraded table above re-verified as still true and unchanged.
