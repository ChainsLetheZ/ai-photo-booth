/** 6-inch photo print specs (6×4 in @ 300 DPI, landscape) */
export const PRINT_6INCH = {
  width: 1800,
  height: 1200,
  dpi: 300,
  label: '6x4',
} as const;

/**
 * Cover-fit image into 6-inch (3:2) canvas — fill frame, no black bars.
 */
export function preparePrintImage(base64: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const { width: targetW, height: targetH } = PRINT_6INCH;
      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(base64);
        return;
      }

      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, targetW, targetH);

      const srcAspect = img.width / img.height;
      const targetAspect = targetW / targetH;
      let dw = targetW;
      let dh = targetH;
      if (srcAspect > targetAspect) {
        dw = targetH * srcAspect;
      } else {
        dh = targetW / srcAspect;
      }
      const dx = (targetW - dw) / 2;
      const dy = (targetH - dh) / 2;
      ctx.drawImage(img, 0, 0, img.width, img.height, dx, dy, dw, dh);
      resolve(canvas.toDataURL('image/jpeg', 0.92));
    };
    img.onerror = () => resolve(base64);
    img.src = base64;
  });
}

export async function sendPrintJob(
  imageBase64: string,
  printerName?: string
): Promise<{ success: boolean; message?: string; error?: string }> {
  const printImage = await preparePrintImage(imageBase64);
  const res = await fetch('/api/print', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imageBase64: printImage,
      printerName: printerName?.trim() || undefined,
      printSize: PRINT_6INCH.label,
    }),
  });
  return res.json();
}
