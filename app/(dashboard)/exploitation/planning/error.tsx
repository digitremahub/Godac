"use client";

import { EcranErreur } from "@/components/shared/EcranErreur";

export default function Erreur({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <EcranErreur error={error} reset={reset} />;
}
