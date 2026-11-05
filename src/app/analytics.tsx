"use client";

import Script from "next/script";

const CONSENT =
  "window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}" +
  "gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:'granted',functionality_storage:'granted',security_storage:'granted'});";

export function Analytics({ id }: { id: string }) {
  return (
    <>
      <Script id="ga-consent" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: CONSENT }} />
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${id}`} strategy="afterInteractive" />
      <Script
        id="ga-init"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{ __html: `gtag('js',new Date());gtag('config','${id}',{page_location:location.origin+location.pathname});` }}
      />
    </>
  );
}
