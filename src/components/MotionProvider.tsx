"use client";

import type { ReactNode } from "react";
import { LazyMotion, MotionConfig, domAnimation } from "motion/react";

/**
 * Mesin animasi (pustaka `motion`) dimuat versi ringan: hanya fitur dasar
 * (masuk/keluar, hover, tap). Komponen memakai `m.div`, bukan `motion.div`.
 * `reducedMotion="user"` menghormati pengaturan "kurangi gerakan" di perangkat.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}
