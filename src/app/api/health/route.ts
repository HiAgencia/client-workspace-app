import { connection } from "next/server";
import { healthStatus } from "@/lib/health";

export async function GET() {
  await connection();
  return Response.json(healthStatus());
}
