/**
 * Renders page 1 of a PDF to a PNG data URL, client-side, via pdfjs-dist.
 * Used so staff can upload a QRIS exactly as printed/emailed by their
 * bank/PSP (a PDF) instead of having to screenshot it into an image first --
 * the static QRIS storage (integration_settings.walkin_qris) only ever
 * holds one raster image, so this is a one-time conversion at upload time,
 * not a general PDF viewer.
 */
export async function pdfFirstPageToPngDataUrl(file: File, targetWidthPx = 900): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const page = await pdf.getPage(1);

  const baseViewport = page.getViewport({ scale: 1 });
  const scale = targetWidthPx / baseViewport.width;
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Kanvas tidak didukung di browser ini");

  await page.render({ canvasContext: context, viewport }).promise;
  return canvas.toDataURL("image/png");
}
