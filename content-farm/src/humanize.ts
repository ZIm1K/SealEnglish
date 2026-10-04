// Humanizer pass: a separate "editor" call rewrites every user-facing text field so it reads like a
// person wrote it (no AI clichés), keeping structure, facts, enums and image prompts intact.
import type { z } from "zod";
import { BRAND_BIBLE, HUMAN_VOICE } from "./brand.ts";
import type { FarmSettings } from "./env.ts";
import { structured, type Budget, type StructuredCall } from "./llm.ts";

const SYSTEM = `Ти — прискіпливий літературний редактор SMM-команди. Отримуєш JSON з контентом і повертаєш ТОЙ САМИЙ JSON
(та сама структура, та сама кількість елементів у масивах, ті самі значення enum/boolean/чисел), де переписано лише
україномовні тексти для людей, щоб вони звучали живо і по-людськи.

Не змінюй: факти, цифри, імена, URL, англійські фрази й репліки англомовних героїв, усе англійською для генератора картинок
(locations[].prompt, visual_style, image_prompt), службові поля (speaker, location, shot, seal_visible, seal_side, seal_pose,
npc_side, kind, mascot, background, answer), hashtags, sources.
Зберігай приблизну довжину кожного поля (±20%) і сенс. Озвучувані репліки мають читатися вголос природно.
Якщо текст уже звучить по-людськи — залиш як є, не переписуй заради переписування.

Для сценаріїв-історій (є поле beats) ти ще й сценарний редактор: прочитай ролик очима глядача, який бачить його вперше.
Якщо сюжет стрибає, репліка не випливає з попередньої, жарт незрозумілий без пояснення, хук спойлерить або обіцяє те,
чого немає, або з'являється нова тема наприкінці — виправ: переформулюй, прибери зайві кадри або додай коротку репліку
оповідача-пояснення. Тоді можна змінювати й кількість кадрів (7–9) та їхні службові поля, щоб усе було узгоджено.
translation англійських реплік має бути точним. Поля spoken і speed не чіпай, якщо не змінюєш саму репліку. Перевір, що жарт зрозумілий без знання англійської.

${HUMAN_VOICE}

## Контекст бренду
${BRAND_BIBLE}`;

export const humanizeCall = <S extends z.ZodType>(schema: S, draft: z.infer<S>, what: string): StructuredCall<S> => ({
  what: `humanize_${what}`,
  cheap: true,
  schema,
  effort: "low",
  system: SYSTEM,
  prompt: `Відредагуй цей JSON:\n${JSON.stringify(draft, null, 2)}`,
});

export async function humanize<S extends z.ZodType>(s: FarmSettings, budget: Budget, schema: S, draft: z.infer<S>, what: string): Promise<z.infer<S>> {
  if (!s.humanize) return draft;
  for (let attempt = 1; ; attempt++) {
    try {
      return await structured({ s, budget, ...humanizeCall(schema, draft, what) });
    } catch (e) {
      if (attempt < 2) continue;
      // The draft is still usable; a failed polish must not cost the whole item — but the owner
      // should know this text never went through the editor.
      budget.notes.push(`без редакторського проходу (редактор двічі не відповів: ${(e as Error).message.slice(0, 120)})`);
      budget.add(`humanize_${what}_failed`, 0);
      return draft;
    }
  }
}
