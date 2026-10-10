# MimiReel Google Play release pack

Prepared locally on September 20, 2026. Nothing in this folder deploys the website or submits an app to Google Play.

Use these files in order:

1. `release-checklist.md` — the release gate and outstanding decisions.
2. `store-listing.md` — ready-to-paste store copy and asset requirements.
3. `data-safety.md` — a field-by-field draft for the Play Console declaration.
4. `closed-testing-plan.md` — the required tester plan and acceptance matrix.
5. `aab-build.md` — build identifiers, signing precautions, and AAB commands.
6. `../../release/README.md` — verified local APK/AAB metadata, checksums, and sideload instructions.

The September 21–22 Play-mode Android build check used the old PulseReel identity. A new MimiReel 32-bit phone-test APK was compiled on September 23, and its package, label, scheme, and debug signature were checked locally. It has not yet been installed or tested on the phone. A production-signed universal MimiReel AAB remains outstanding.

The planned package name is `com.mimireel.app`. It has not been registered in Play Console. Confirm availability and the final identifier before uploading the first AAB.
