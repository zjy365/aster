import { Hero } from "@/components/hero";
import { SectionSeparator } from "@/components/section-separator";
import { Principles } from "@/components/principles";
import { FeatureBento } from "@/components/feature-bento";
import { Security } from "@/components/security";
import { Download } from "@/components/download";
import { Faq } from "@/components/faq";
import { SiteFooter } from "@/components/site-footer";

export default function Page() {
  return (
    <>
      <main>
        <Hero />
        <SectionSeparator label="why aster" />
        <Principles />
        <FeatureBento />
        <Security />
        <Download />
        <SectionSeparator label="faq" />
        <Faq />
      </main>
      <SiteFooter />
    </>
  );
}
