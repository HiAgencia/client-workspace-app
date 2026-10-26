import { connection } from "next/server";
import { healthStatus } from "@/lib/health";

// Rendered on every request, never prerendered: the check proves the Worker runs code, not that a cached file exists.
export async function GET() {
  await connection();
  return Response.json(healthStatus());
}
