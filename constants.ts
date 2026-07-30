export const LOCAL_STORAGE_KEY = 'uxml4_participants_v1';

/** Hardcoded event slogan — from Supplier Day 2026 KV */
export const EVENT_SLOGAN = {
  primary: '竞速智联 共塑致远',
  secondary: 'Bosch China Supplier Day 2026',
  eventTitle: '博世2026中国区供应商大会',
} as const;

/** Key visual asset (wall assemble backdrop) */
export const EVENT_KV_SRC = '/kv-supplier-day-2026.png';

/** Photo booth realtime cutout background */
export const BOOTH_BG_SRC = '/booth-bg.png';

/** localStorage key for custom booth cutout background (data URL) */
export const BOOTH_BG_STORAGE_KEY = 'uxml4_booth_bg_v1';

/** 6-inch print dimensions for server-side reference */
export const PRINT_6INCH_SERVER = {
  width: 1800,
  height: 1200,
  media: '6x4',
} as const;
