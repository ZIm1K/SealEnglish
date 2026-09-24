import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Тест рівня англійської",
  robots: { index: false, follow: false },
};

export default function LevelTestLayout({ children }: { children: React.ReactNode }) {
  return children;
}
