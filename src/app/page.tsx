import type { Metadata } from "next";
import { PRODUCT_DESCRIPTION } from "@/lib/product";
import { pageMetadata } from "@/lib/seo";
import { LandingHome } from "./landing-home";

export const metadata: Metadata = pageMetadata({ lang: "en", path: "", title: null, description: PRODUCT_DESCRIPTION });

export default function Home({ searchParams }: PageProps<"/">) {
  return <LandingHome lang="en" failed={searchParams.then(({ auth }) => auth === "failed")} />;
}
