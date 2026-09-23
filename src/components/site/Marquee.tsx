const TOPICS = ["Speaking", "НМТ 2027", "Grammar that works", "Movies & series", "Gaming", "Music", "Travel", "Cambridge B1–C1", "Debates", "Vocabulary", "Social media", "IT English"];

export function Marquee() {
  return (
    <div className="relative -mt-px overflow-hidden border-y border-line bg-white py-5" aria-hidden>
      <div className="flex w-max motion-safe:animate-drift" style={{ animationDuration: "40s" }}>
        {[0, 1].map((k) => (
          <div key={k} className="flex shrink-0 items-center">
            {TOPICS.map((t) => (
              <span key={t} className="flex items-center font-display text-lg font-semibold whitespace-nowrap text-ocean-900/80 sm:text-xl">
                <span className="px-6">{t}</span>
                <span className="text-coral-400">✦</span>
              </span>
            ))}
          </div>
        ))}
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-white to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-white to-transparent" />
    </div>
  );
}
