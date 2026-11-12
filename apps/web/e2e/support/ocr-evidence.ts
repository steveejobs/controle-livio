import type { Page } from '@playwright/test';

type OcrObservation = { text: string; confidence: number | null };
type ObservedWindow = Window & { __livioSyntheticOcr?: OcrObservation[] };

// Test-only observer: real Worker, real messages, no replacements of OCR results or DOM.
// Only the synthetic image scenarios install this observer; product code is unchanged.
export async function observeSyntheticOcr(page: Page) {
  await page.addInitScript(() => {
    const target = window as ObservedWindow;
    target.__livioSyntheticOcr = [];
    const OriginalWorker = window.Worker;
    window.Worker = class extends OriginalWorker {
      constructor(...args: ConstructorParameters<typeof Worker>) {
        super(...args);
        this.addEventListener('message', (event: MessageEvent) => {
          const data = event.data?.data;
          if (event.data?.status === 'resolve' && typeof data?.text === 'string')
            target.__livioSyntheticOcr?.push({
              text: data.text,
              confidence: typeof data.confidence === 'number' ? data.confidence : null,
            });
        });
      }
    };
  });
}

export async function syntheticOcrObservations(page: Page) {
  return page.evaluate(() => (window as ObservedWindow).__livioSyntheticOcr ?? []);
}
