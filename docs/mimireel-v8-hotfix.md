# MimiReel Version 8 hotfix

Phone crash log on October 13 confirms `VideoPlayer.pause` called after native shared object release from MoviePreview during navigation. Cleanup now tolerates only the known already-released error; unrelated failures are not silently swallowed. Expo still owns automatic player disposal.

Movie options now use a custom modal instead of Android Alert's three-button limit. Backdrop tap, Android Back, and explicit Cancel dismiss it. Report, Open, Download, and optional Block remain visible; an action dismisses the modal before executing.

Validation: mobile TypeScript passed, six feedback/navigation tests passed, Android Metro/Hermes export passed (1466 modules). No phone data changed. Updated native UI still requires checking through a Play-signed update.

Play release notes: Fixes a crash when returning from movie preview to Watch. Movie options can now be dismissed by tapping outside, pressing Back, or choosing Cancel.

Device checks: open a completed movie, play/pause, return to Watch repeatedly; return to Your Movies and open again. Check options backdrop, Back, Cancel, Open, Download, and Report without submitting a report unnecessarily. Confirm existing thumbnails and uploads remain intact.
