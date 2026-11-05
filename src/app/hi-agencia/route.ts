import { AGENCY_URL } from "@/lib/agency";

export function GET() {
  return Response.redirect(AGENCY_URL, 301);
}
