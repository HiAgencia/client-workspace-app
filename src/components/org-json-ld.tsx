import { organizationJsonLd } from "@/lib/seo";

export function OrgJsonLd() {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: organizationJsonLd() }} />;
}
