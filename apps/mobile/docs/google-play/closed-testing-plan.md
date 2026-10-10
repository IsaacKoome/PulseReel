# Closed testing plan

New personal Play Console accounts may be required to run a closed test with at least 12 opted-in testers continuously for 14 days before production access. The Play Console account dashboard is the final authority for this account's exact requirement.

## Recruitment target

- Recruit 15–18 reliable people so at least 12 remain opted in for the full period.
- Use a Google Group or an email list controlled by the developer.
- Ask testers not to leave the test until the production-access application is submitted.
- Record each tester's device model, Android version, network type, start date, and completion status.

## Suggested device coverage

- Android 10–16 where available
- At least one low-memory/entry-level phone
- Samsung, Tecno/Infinix, Xiaomi/Redmi, and Pixel or another near-stock Android device
- Wi-Fi and mobile data
- Small and large screens
- At least one device with limited free storage

## 14-day test rhythm

**Day 1 — install and identity**  
Install from the Play test link, launch, sign in, inspect permission prompts, and confirm Privacy/Terms links.

**Days 2–3 — creation inputs**  
Record a clip, select a gallery clip, capture an identity frame, enter a scene idea, and test invalid/empty input.

**Days 4–5 — generation lifecycle**  
Submit over Wi-Fi and mobile data, background/resume the app, observe progress, retry a recoverable failure, and check the result.

**Days 6–7 — publishing and playback**  
Keep one movie private, publish one movie, replay and pause it, rotate the network off/on, and share a link.

**Days 8–9 — community controls**  
Like, comment, follow, unfollow, report a movie, report a comment, block a creator, and confirm blocked content disappears.

**Days 10–11 — account/data controls**  
Open policy pages, review the deletion page, and have one designated test account submit a deletion request.

**Days 12–13 — resilience**  
Test poor connectivity, expired sign-in/session recovery, denied permissions, low storage, app restart, and repeated refresh.

**Day 14 — regression and survey**  
Repeat the main path from install to generated result, record remaining issues, and complete the tester survey.

## Acceptance criteria

- No crash or unrecoverable blank screen in the main path
- Sign-in and session recovery work on supported devices
- Permission denials produce a useful recovery path
- Creation never submits twice from one tap
- Users understand when generation is pending, failed, private, or published
- Video playback is usable on mobile data and Wi-Fi
- Report/block controls are discoverable and persist after refresh
- A blocked creator's public movies no longer appear to that user
- In-app deletion request reaches the backend exactly once
- No external payment page opens in the Google Play release
- Policy links are publicly reachable

## Feedback questions

1. What device and Android version did you use?
2. Could you sign in and understand the permissions?
3. Did the recording/upload step work the first time?
4. Was generation status clear while waiting?
5. Did the finished scene play smoothly?
6. Could you find report, block, privacy, and deletion controls?
7. Did anything crash, freeze, repeat, or lose your work?
8. What is the single most confusing part?
9. Would you publish or share a result? Why or why not?

Keep screenshots, issue logs, fixes, and a short summary of tester feedback. Play may ask about engagement, feedback received, and changes made when production access is requested.
