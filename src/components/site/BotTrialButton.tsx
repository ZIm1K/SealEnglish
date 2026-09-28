"use client";

import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SITE } from "@/content/site";
import { botTrialLink, track } from "@/lib/analytics";

/** Alternative to the web form: the bot asks 3 questions and takes the phone with one tap. */
export function BotTrialButton({
  placement, bot = SITE.telegramBot, className, primary, children,
}: {
  placement: string;
  bot?: string;
  className?: string;
  primary?: boolean;
  children?: React.ReactNode;
}) {
  if (!bot) return null;
  return (
    <Button asChild variant={primary ? "primary" : "outline"} size={primary ? "xl" : "lg"} className={className}>
      <a
        href={`https://t.me/${bot}?start=trial`}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => {
          // Static HTML has no URL params; the campaign is added at click time.
          e.currentTarget.href = botTrialLink(bot);
          track("bot_click", { placement });
        }}
      >
        <Send className={primary ? undefined : "text-sky-500"} /> {children ?? "Записатися в Telegram"}
      </a>
    </Button>
  );
}
