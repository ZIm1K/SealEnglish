"use client";

import { toast } from "sonner";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/overlay";

export function CredentialsDialog({ data, onClose }: { data: { email: string; password: string; name: string } | null; onClose: () => void }) {
  const text = data ? `Seal English — доступ до кабінету\n${typeof window !== "undefined" ? window.location.origin : ""}/login/\nЛогін (email): ${data.email}\nПароль: ${data.password}` : "";
  return (
    <Dialog open={!!data} onOpenChange={(v) => !v && onClose()}>
      {data && (
        <DialogContent title="Акаунт готовий 🎉" description={`Передайте дані для входу: ${data.name}. Пароль показується лише один раз.`}>
          <div className="grid gap-4">
            <pre className="rounded-2xl bg-ocean-900 p-4 font-mono text-sm whitespace-pre-wrap text-seal-100">{text}</pre>
            <Button
              onClick={() => {
                navigator.clipboard.writeText(text);
                toast.success("Скопійовано");
              }}
            >
              <Copy /> Скопіювати
            </Button>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
