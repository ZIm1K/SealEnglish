import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { SealLost } from "@/components/site/SealLost";

export default function NotFound() {
  return (
    <main className="relative flex min-h-svh flex-col items-center justify-center overflow-hidden bg-ocean-950 px-6 text-center text-white">
      <div aria-hidden className="absolute -top-40 left-1/2 size-[40rem] -translate-x-1/2 rounded-full bg-seal-600/25 blur-[120px]" />
      <div className="relative w-56 sm:w-64">
        <SealLost />
      </div>
      <p className="relative mt-6 font-display text-7xl font-bold text-seal-300">404</p>
      <h1 className="relative mt-2 font-display text-2xl font-bold">Ой, сторінка кудись запливла</h1>
      <p className="relative mt-2 max-w-sm text-seal-100/70">Сілі шукав її по всьому океану, але не знайшов. Повернімося на головну?</p>
      <Link href="/" className="relative mt-8 inline-flex h-12 items-center gap-2 rounded-2xl bg-coral-500 px-6 font-semibold text-white shadow-coral transition hover:bg-coral-600">
        <ArrowLeft className="size-4" /> На головну
      </Link>
    </main>
  );
}
