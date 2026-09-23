import { SiteHeader } from "@/components/site/SiteHeader";
import { Hero } from "@/components/site/Hero";
import { Programs } from "@/components/site/Programs";
import { Method } from "@/components/site/Method";
import { Platform } from "@/components/site/Platform";
import { Pricing } from "@/components/site/Pricing";
import { Faq } from "@/components/site/Faq";
import { TrialSection } from "@/components/site/TrialForm";
import { SiteFooter } from "@/components/site/SiteFooter";
import { Marquee } from "@/components/site/Marquee";
import { FAQ, SITE } from "@/content/site";

export default function Home() {
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "EducationalOrganization",
      name: SITE.name,
      url: SITE.url,
      description: SITE.description,
      email: SITE.email,
      areaServed: "UA",
      availableLanguage: ["uk", "en"],
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: FAQ.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
    },
  ];
  return (
    <>
      <SiteHeader />
      <main>
        <Hero />
        <Marquee />
        <Programs />
        <Method />
        <Platform />
        <Pricing />
        <TrialSection />
        <Faq />
      </main>
      <SiteFooter />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
    </>
  );
}
