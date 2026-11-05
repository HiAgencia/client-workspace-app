import type { Metadata } from "next";
import { pageMetadata, PRODUCT_DESCRIPTION_ES } from "@/lib/seo";
import { LandingHome } from "../landing-home";

export const metadata: Metadata = pageMetadata({ lang: "es", path: "", title: null, description: PRODUCT_DESCRIPTION_ES });

export default function HomeEs({ searchParams }: PageProps<"/es">) {
  return <LandingHome lang="es" failed={searchParams.then(({ auth }) => auth === "failed")} />;
}
