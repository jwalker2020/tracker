import { z } from "zod";

const hexColor = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, "Color must be a hex code (e.g. #3b82f6)");

export const gpxUploadSchema = z.object({
  name: z.string().max(500).optional(),
  color: hexColor,
});

export type GpxUploadInput = z.infer<typeof gpxUploadSchema>;

/** Validate file is .gpx by name (client-side). */
export function isGpxFileName(name: string): boolean {
  return name.toLowerCase().endsWith(".gpx");
}
