export type MovieTemplate = {
  id: string;
  name: string;
  tagline: string;
  runtimeLabel: string;
  palette: [string, string, string];
  genres: string[];
  hook: string;
  openingShot: string;
  beats: [string, string, string];
  posterMood: string;
};

export const movieTemplates: MovieTemplate[] = [
  {
    id: "rise-mode",
    name: "Rise Mode",
    tagline: "From ordinary pressure to impossible comeback energy.",
    runtimeLabel: "30-45 sec",
    palette: ["#f97316", "#7c2d12", "#1e293b"],
    genres: ["Motivation", "Street drama", "Comeback"],
    hook: "The world doubts you right before your breakthrough arrives.",
    openingShot: "Low-angle walk into frame with city lights and tension building.",
    beats: [
      "Introduce the pressure and what the world sees on the outside.",
      "Reveal the internal switch where the creator refuses to stay small.",
      "End on a victorious image that feels bigger than the original setting.",
    ],
    posterMood: "Amber sparks, steel blue shadows, triumphant silhouette.",
  },
  {
    id: "heartline",
    name: "Heartline",
    tagline: "Turn a personal memory into a cinematic confession.",
    runtimeLabel: "20-30 sec",
    palette: ["#fb7185", "#7c3aed", "#172554"],
    genres: ["Romance", "Memory", "Confessional"],
    hook: "A private feeling becomes the scene everyone remembers.",
    openingShot: "Soft close-up, reflective lighting, voice-first emotion.",
    beats: [
      "Open with the exact memory that still lingers.",
      "Contrast what was felt inside with what was said out loud.",
      "Close with a line that lands like the last page of a diary.",
    ],
    posterMood: "Velvet neon, rain reflections, intimate spotlight.",
  },
  {
    id: "mythic-shift",
    name: "Mythic Shift",
    tagline: "Recast your life as a world-building fantasy trailer.",
    runtimeLabel: "45-60 sec",
    palette: ["#67e8f9", "#0f766e", "#082f49"],
    genres: ["Fantasy", "Adventure", "Legend"],
    hook: "Your normal life is secretly the origin story of a larger destiny.",
    openingShot: "Wind, distant ambience, and a slow reveal into a mythic stance.",
    beats: [
      "Establish the ordinary place that hides a larger fate.",
      "Introduce a call to action that pulls the creator into legend.",
      "Finish with a prophecy-like promise of what comes next.",
    ],
    posterMood: "Glacial cyan, deep teal fog, mystical horizon glow.",
  },
];

export function getTemplateById(id: string) {
  return movieTemplates.find((template) => template.id === id) ?? movieTemplates[0];
}

