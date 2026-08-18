import { SiteNav } from "@/components/site-nav";
import { Hero } from "@/components/hero";
import { Principles } from "@/components/principles";
import { FeatureBento } from "@/components/feature-bento";
import { Security } from "@/components/security";
import { Download } from "@/components/download";
import { Faq } from "@/components/faq";
import { SiteFooter } from "@/components/site-footer";

export default function Page() {
  return (
    <>
      <SiteNav />
      <main>
        <Hero />
        <Principles />
        <FeatureBento />
        <Security />
        <Download />
        <Faq />
      </main>
      <SiteFooter />
    </>
  );
}
