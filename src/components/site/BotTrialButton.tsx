"use client";

import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SITE } from "@/content/site";
import { track } from "@/lib/analytics";

/** Alternative to the web form: the bot asks 3 questions and takes the phone with one tap. */
export function BotTrialButton({ placement, bot = SITE.telegramBot, className }: { placement: string; bot?: string; className?: string }) {
  if (!bot) return null;
  return (
    <Button asChild variant="outline" size="lg" className={className}>
      <a
        href={`https://t.me/${bot}?start=trial`}
        target="_blank"
        rel="noreferrer"
        onClick={() => track("bot_click", { placement })}
      >
        <Send className="text-sky-500" /> Записатися в Telegram
      </a>
    </Button>
  );
}
