# MOBILE_BUILD.md

**NOT IMPLEMENTED.**

No Capacitor configuration (`capacitor.config.ts`/`.json`), no `android/` or `ios/` native project directories, no `@capacitor/*` dependency in `package.json`/`package-lock.json`, and no mobile-specific build scripts exist anywhere in this repository.

This is a standard responsive Next.js web app (Tailwind CSS classes throughout suggest mobile-responsive design intent, e.g. `sm:`/`lg:` breakpoints seen in `src/app/admin/page.tsx`), but there is no native mobile wrapper, app-store packaging, or device-build tooling. Users would access it via mobile browser only.

UNKNOWN — NEEDS CONFIRMATION: whether a native mobile app is planned or exists in a separate, unrelated repository.
