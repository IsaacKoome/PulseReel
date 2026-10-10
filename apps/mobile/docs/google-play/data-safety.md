# Google Play Data safety draft

This is a release-preparation worksheet, not a substitute for checking the exact Play Console form and the current contracts/settings of Supabase, Vercel, Replicate, Google, and any analytics or crash service. Submit only answers that match the shipped AAB.

## High-level answers

- Does the app collect or share required user-data types? **Yes, it collects data.**
- Is all user data encrypted in transit? **Yes**, provided all production endpoints remain HTTPS and provider connections remain TLS-protected.
- Can users request deletion? **Yes.** In-app: Profile → Account and data → Request account deletion. Web: `https://pulse-reel.vercel.app/data-deletion`.
- Is data collection optional? Account identity is required for authenticated features. Media, prompts, and social activity are supplied when the user chooses the associated feature.
- Does the app follow the Families policy? **Not presented as a children/families app.** Confirm target audience selections before release.

## Data types to declare

| Play category | MimiReel data | Collected | Shared | Purpose |
|---|---|---:|---:|---|
| Personal info — Name | Google display name / creator name | Yes | Verify provider exception | Account management, app functionality |
| Personal info — Email address | Google sign-in email and deletion-request email | Yes | Verify provider exception | Account management, support, deletion verification |
| Personal info — User IDs | Supabase/Google-linked account identifier | Yes | Verify provider exception | Authentication, security, account association |
| Photos and videos | Source clip, identity selfie/frame, generated movie and poster | Yes | Verify provider exception | App functionality, AI movie generation |
| User-generated content — Other | Prompts, comments, published movie metadata, reports | Yes | Published items may be visible to users | App functionality, moderation, community features |
| App activity — App interactions | Likes, follows, shares, creator blocks, generation status | Yes | Verify provider exception | App functionality, analytics/quality, fraud prevention |
| App info and performance — Diagnostics | Server/request error records and provider job status | Yes | Verify provider exception | Reliability, debugging, security |
| Financial info — Purchase history | Not collected by the current Play release because purchases are disabled | No for v1 | No for v1 | Reassess when Play Billing is added |

“Verify provider exception” means the information is transmitted to processors that operate the service. Google Play may allow service-provider processing not to count as “sharing” only when its definition and contractual requirements are satisfied. Confirm this in Play Console instead of guessing.

## Data not intentionally collected by the current release

- Precise or approximate location
- Contacts
- SMS or MMS
- Call logs
- Health and fitness information
- Calendar data
- Web browsing history
- Audio files as a separate library item (audio may be embedded in a user-selected/recorded video)
- Advertising ID for advertising or cross-app tracking

Re-check the generated Android manifest and every SDK before submission. A newly added analytics, crash-reporting, advertising, payment, or attribution SDK can change these answers.

## Processing map

- Supabase: authentication, account identity, social/control records, project metadata
- Vercel: application/API hosting, operational logs, file/blob storage where configured
- Replicate or selected AI provider: source media and prompt inputs required to generate the requested movie
- Google: Google sign-in; Google Play distribution; later, Play Billing if implemented

## Retention and deletion statement

Source media, generated movies, project records, and social activity are retained while needed to provide the service or until the user deletes applicable content/account data. Deletion requests may require identity verification. Limited records can remain temporarily in provider backups, fraud-prevention records, transaction records required by law, or security logs until their normal retention period expires.

## Console cross-checks

- [ ] Privacy URL is public and matches these answers
- [ ] Deletion URL is public and describes both in-app and web request paths
- [ ] Generated AAB does not contain an undeclared analytics/ad SDK
- [ ] Camera, microphone, and media permissions are feature-triggered and explained in context
- [ ] Paystack/browser checkout is absent from the production Play build
- [ ] Replicate/provider handling is covered by the current privacy notice
- [ ] Published content visibility and sharing are described accurately
- [ ] Report and block controls work on the release backend
