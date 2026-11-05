import { getCloudflareContext } from "@opennextjs/cloudflare";
import { SPANISH_COUNTRIES } from "@/lib/language";

export async function GET() {
  let offer = false;
  try {
    const country = getCloudflareContext().cf?.country;
    offer = typeof country === "string" && SPANISH_COUNTRIES.has(country);
  } catch {
    offer = false;
  }
  return Response.json({ offer }, { headers: { "Cache-Control": "private, no-store" } });
}
