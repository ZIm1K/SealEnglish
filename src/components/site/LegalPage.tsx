import { SiteHeader } from "./SiteHeader";
import { SiteFooter } from "./SiteFooter";

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <>
      <SiteHeader solid />
      <main className="container-page max-w-3xl pt-[calc(var(--header-h)+3rem)] pb-24">
        <h1 className="font-display text-3xl font-bold text-ocean-900 sm:text-4xl">{title}</h1>
        <p className="mt-2 text-sm text-mute">Оновлено: {updated}</p>
        <div className="mt-10 grid gap-6 leading-relaxed text-ink-soft [&_h2]:mt-4 [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-ocean-900 [&_li]:ml-5 [&_li]:list-disc [&_ul]:grid [&_ul]:gap-2">
          {children}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
