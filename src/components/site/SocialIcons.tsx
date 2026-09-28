import { Send } from "lucide-react";
import { SITE } from "@/content/site";

type IconProps = React.SVGProps<SVGSVGElement>;

export function InstagramIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} {...props}>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.2" cy="6.8" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function TikTokIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M16.6 5.82a4.28 4.28 0 0 1-3.02-3.7h-3.16v13.2a2.6 2.6 0 1 1-1.84-2.49V9.6a5.86 5.86 0 1 0 5 5.8V9.75a7.4 7.4 0 0 0 4.32 1.38V8a4.28 4.28 0 0 1-1.3-.18v-2Z" />
    </svg>
  );
}

export function ThreadsIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M12 22c-4.4 0-7.6-2.9-7.6-8.3v-1.4C4.4 6.8 7.6 4 12 4c3.3 0 5.9 1.6 6.9 4.3l-1.9.6C16.3 6.9 14.5 5.9 12 5.9c-3.3 0-5.6 2-5.6 6.4v1.4c0 4.4 2.3 6.4 5.6 6.4 2.6 0 4.3-1.1 4.3-2.9 0-1.5-1.1-2.3-3-2.6-.2 1.7-1.4 2.8-3.2 2.8-1.7 0-2.9-1-2.9-2.5 0-1.6 1.4-2.6 3.6-2.6.6 0 1.1 0 1.6.1 0-1.3-.8-2-2.1-2-1 0-1.8.4-2.3 1.2l-1.6-1.1c.8-1.3 2.3-2.1 4-2.1 2.5 0 4 1.5 4 3.9v.5c2.3.5 3.7 1.9 3.7 4 0 2.8-2.3 4.6-6.1 4.6Zm-.4-6.8c-1.1 0-1.7.4-1.7.9 0 .6.6.9 1.3.9.9 0 1.5-.5 1.6-1.6-.4-.1-.8-.2-1.2-.2Z" />
    </svg>
  );
}

export const SOCIALS = [
  {
    id: "telegram",
    name: "Telegram",
    handle: "@sealenglish",
    text: "Анонси груп, помилки тижня й лайфхаки для НМТ",
    href: SITE.social.telegram,
    Icon: Send,
    tile: "bg-[#229ED9]",
  },
  {
    id: "instagram",
    name: "Instagram",
    handle: "@sealenglishschool",
    text: "Життя школи, каруселі з корисностями й сторіз з уроків",
    href: SITE.social.instagram,
    Icon: InstagramIcon,
    tile: "bg-[linear-gradient(135deg,#FEDA75_0%,#FA7E1E_25%,#D62976_55%,#962FBF_80%,#4F5BD5_100%)]",
  },
  {
    id: "tiktok",
    name: "TikTok",
    handle: "@sealenglish.school",
    text: "Англійська за 30 секунд — коротко, смішно і по ділу",
    href: SITE.social.tiktok,
    Icon: TikTokIcon,
    tile: "bg-[#010101] shadow-[inset_2px_0_0_#25F4EE,inset_-2px_0_0_#FE2C55]",
  },
  {
    id: "threads",
    name: "Threads",
    handle: "@sealenglishschool",
    text: "Короткі поради, дискусії та питання від учнів",
    href: SITE.social.threads,
    Icon: ThreadsIcon,
    tile: "bg-[#101010]",
  },
] as const;
