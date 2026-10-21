"use client";

import { FinanceShell } from "../_shell";
import { RencanaKas } from "../_RencanaKas";

export default function RencanaKasPage() {
  return (
    <FinanceShell pageTitle="Rencana Kas" pageSub="Uang sudah di mana, kapan cair, dan ke mana">
      <RencanaKas />
    </FinanceShell>
  );
}
