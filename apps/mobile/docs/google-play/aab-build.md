# Android App Bundle build guide

## Immutable identifiers

- Planned package/application ID: `com.mimireel.app` (not registered in Play Console yet)
- Display name: MimiReel
- Marketing version: `1.0.0`
- Initial local version code: `1`
- Production EAS builds automatically increment the remote version code

Confirm the package ID before the first Play upload. Google Play ties the listing to that ID permanently.

## Recommended first path: EAS production AAB

This builds the Android artifact without deploying the existing web application to Vercel.

```powershell
cd "C:\Users\Isaac\Documents\New project\apps\mobile"
npx eas-cli build --platform android --profile production
```

The `production` profile sets `EXPO_PUBLIC_GOOGLE_PLAY_RELEASE=true` and `android.buildType=app-bundle`, so the result is an `.aab` and the external Paystack checkout is disabled.

Before starting the build:

- Ensure the Expo account can access owner `komecon` and project `4987d251-7cbb-4840-a668-f0800bbed6e7`.
- Decide whether EAS should generate/manage the Android upload keystore or whether an existing secure key will be supplied.
- Store keystore credentials securely and outside Git.
- Verify production environment variables are configured for the build.
- Add `mimireel://auth/callback` to the Supabase redirect allowlist and verify sign-in in a new test build.
- Replace placeholder app icons first; otherwise a rebuild will be required.

## Fully local build path

The local Android toolchain is now installed and a native `android` project has been generated:

- Microsoft OpenJDK 17
- Android SDK Platform 36 and Build Tools 36.0.0
- Android platform-tools, NDK 27.1.12297006, and CMake 3.22.1
- Gradle wrapper in `android\gradlew.bat`

The normal workspace path is long enough to exceed Windows' legacy path limit during React Native native compilation. A directory junction at `C:\p` points to the repository root and keeps generated paths short without moving the project.

Build a local ARM64 release check with Google Play behavior enabled:

```powershell
$env:JAVA_HOME = [Environment]::GetEnvironmentVariable("JAVA_HOME", "Machine")
$env:ANDROID_HOME = [Environment]::GetEnvironmentVariable("ANDROID_HOME", "User")
$env:NODE_ENV = "production"
$env:EXPO_PUBLIC_GOOGLE_PLAY_RELEASE = "true"
& "C:\p\apps\mobile\android\gradlew.bat" `
  -p "C:\p\apps\mobile\android" `
  assembleRelease bundleRelease `
  -PreactNativeArchitectures=arm64-v8a
```

Outputs are written to:

- APK: `android\app\build\outputs\apk\release\app-release.apk`
- AAB: `android\app\build\outputs\bundle\release\app-release.aab`

The September 21 local build used the old PulseReel package and Android debug certificate. It proves the earlier app compiled, but is **not a MimiReel or upload-ready AAB**. Configure a secure production upload key (or let EAS manage one) and rebuild before uploading to Play Console. Never create or commit a plaintext signing password, `.jks`, or `.keystore` file.

Do not run `prebuild --clean` over hand-edited native files without reviewing its effect.

## Validate before Play upload

- Install/test the local release APK on at least one physical ARM64 Android device.
- Inspect the release manifest and permissions.
- Confirm package, version name, and version code.
- Confirm the production API URL and authentication callback work.
- Confirm report/block/deletion APIs work against the migrated backend.
- Confirm no browser/Paystack checkout can open.
- Confirm camera and microphone permissions are requested only when the user enters recording.
- Archive the exact source commit, configuration, and test notes corresponding to the AAB.

## Play tracks

1. Upload to Internal testing for rapid installation checks.
2. Promote/fix into Closed testing for the required tester period.
3. Apply for Production access when the account's testing requirement is satisfied.
4. Use staged rollout for the first public release rather than 100% immediately.
