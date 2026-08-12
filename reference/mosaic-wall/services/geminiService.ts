
import { GeminiAnalysis } from "../types";

const FALLBACK_VIBES = [
  "Creative",
  "Empathetic",
  "Insightful",
  "User-centered",
  "Detail-oriented",
  "Structured",
  "Collaborative",
  "Communicative"
];

const FALLBACK_COLORS = [
  '#FFCF00', // Yellow
  '#FF5152', // Red
  '#9E2896', // Purple (deep)
  '#E48CDD', // Purple (bright)
  '#007BC0', // Blue (primary)
  '#00A4FD', // Blue (bright)
  '#18837E', // Turquoise (primary)
  '#79C5C0', // Turquoise (light)
  '#00884A', // Green (primary)
  '#5EBD82'  // Green (bright)
];

const getRandomFallback = (): GeminiAnalysis => ({
  vibe: FALLBACK_VIBES[Math.floor(Math.random() * FALLBACK_VIBES.length)],
  color: FALLBACK_COLORS[Math.floor(Math.random() * FALLBACK_COLORS.length)]
});

export const analyzeParticipantImage = async (base64Image: string): Promise<GeminiAnalysis> => {
  // Simulate a very short processing delay for UX feel, but no API call
  await new Promise(resolve => setTimeout(resolve, 300));
  
  // Return random attributes immediately
  return getRandomFallback();
};
