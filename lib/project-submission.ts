/**
 * Prepare the video fields sent to /api/projects.
 *
 * The file input is named `videoUpload`, so FormData(form) includes the source
 * file automatically. That browser-only field must never reach the project API:
 * large files are uploaded to Blob first, while the legacy path sends one
 * canonical `video` field.
 */
export function setProjectVideo(
  formData: FormData,
  video: File,
  videoBlobUrl?: string,
) {
  formData.delete("videoUpload");
  formData.delete("video");
  formData.delete("videoBlobUrl");

  if (videoBlobUrl) {
    formData.set("videoBlobUrl", videoBlobUrl);
    return;
  }

  formData.set("video", video);
}
