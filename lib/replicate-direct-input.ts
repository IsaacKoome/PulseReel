export type DirectSeedancePromptProject = {
  creatorName: string;
  premise: string;
  scenePrompt: string;
  persona: string;
  cameraMode?: "cinematic" | "selfie";
};

export function buildDirectSeedancePrompt(project: DirectSeedancePromptProject) {
  const cameraDirection = project.cameraMode === "selfie"
    ? "The main character records the experience as a deliberate selfie story with natural handheld movement."
    : "This is not a selfie: another camera films the main character inside the scene with cinematic composition and environmental depth.";

  return (
    "IDENTITY LOCK: The real person in the supplied starting frame is the main character and must remain clearly " +
    "recognizable throughout the movie. Preserve their facial structure, natural eye proportions, skin tone, hair, " +
    "age, body proportions, and distinguishing features. Keep a relaxed natural expression and a closed mouth unless " +
    "the story explicitly requests speech. Never replace them with another actor. " +
    `Story: ${project.scenePrompt} ${project.premise} The main character is ${project.creatorName}, ${project.persona}. ` +
    `${cameraDirection} Place that same person naturally inside the requested setting and make them perform one clear ` +
    "readable action. Photorealistic live action, realistic background people, natural motion, stable anatomy, natural " +
    "skin texture, cinematic lighting, and synchronized ambient sound. Continue as one coherent shot. No montage, " +
    "captions, interface graphics, invented writing, logos, distorted faces, face morphing, identity drift, duplicate " +
    "people, enlarged eyes, frozen stare, or unnatural mouth movement."
  ).slice(0, 2500);
}

export function buildDirectSeedanceInput(
  project: DirectSeedancePromptProject,
  identityImageUrl: string,
) {
  return {
    prompt: buildDirectSeedancePrompt(project),
    image: identityImageUrl,
    duration: 5,
    resolution: "480p",
    aspect_ratio: "9:16",
    generate_audio: true,
    fps: 24,
    camera_fixed: false,
  };
}

export function findReplicateOutputUrl(output: unknown): string | null {
  if (typeof output === "string" && /^https?:\/\//i.test(output)) return output;
  if (Array.isArray(output)) {
    for (const item of output) {
      const found = findReplicateOutputUrl(item);
      if (found) return found;
    }
  }
  if (output && typeof output === "object") {
    for (const value of Object.values(output as Record<string, unknown>)) {
      const found = findReplicateOutputUrl(value);
      if (found) return found;
    }
  }
  return null;
}
