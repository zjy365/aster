import type { ReactNode } from "react";
import Link from "next/link";
import { AsterMark } from "@/components/aster-mark";
import { Container } from "@/components/container";
import { SiteFooter } from "@/components/site-footer";

export default function BlogLayout({ children }: { children: ReactNode }) {
  return <>
    <header id="top" className="border-b border-hairline-soft py-6">
      <Container><nav aria-label="Main navigation" className="flex flex-wrap items-center justify-between gap-5">
        <Link href="/" className="flex items-center gap-2 font-semibold"><AsterMark />Aster</Link>
        <div className="flex flex-wrap gap-6 text-sm"><Link href="/blog/">Kubernetes guides</Link><Link href="/#download">Download</Link></div>
      </nav></Container>
    </header>
    <main>{children}</main>
    <SiteFooter />
  </>;
}
