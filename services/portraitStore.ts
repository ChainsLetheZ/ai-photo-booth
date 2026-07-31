import { LOCAL_STORAGE_KEY } from '../constants';
import type { PortraitRecord } from '../types';

const channel =
  typeof BroadcastChannel !== 'undefined'
    ? new BroadcastChannel('bosch-future-portraits')
    : null;

function readLocal(): PortraitRecord[] {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

function writeLocal(records: PortraitRecord[]) {
  // Full-resolution data URLs exhaust the small localStorage quota quickly.
  // Keep only as many recent fallbacks as the browser can actually persist,
  // and never let a local fallback failure block publishing to the server.
  let recent = records.slice(-8);
  while (recent.length > 0) {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(recent));
      return;
    } catch {
      recent = recent.slice(1);
    }
  }
}

export async function listPortraits(): Promise<PortraitRecord[]> {
  try {
    const response = await fetch('/api/portraits');
    if (!response.ok) throw new Error('Portrait service unavailable');
    const records = (await response.json()) as PortraitRecord[];
    writeLocal(records);
    return records;
  } catch {
    return readLocal();
  }
}

export async function publishPortrait(record: PortraitRecord): Promise<void> {
  const local = [...readLocal().filter((item) => item.id !== record.id), record];
  writeLocal(local);
  channel?.postMessage(record);

  try {
    await fetch('/api/portraits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    });
  } catch {
    // Same-device fallback is already persisted.
  }
}

export function subscribeToPortraits(onRecord: (record: PortraitRecord) => void) {
  const onChannelMessage = (event: MessageEvent<PortraitRecord>) => onRecord(event.data);
  channel?.addEventListener('message', onChannelMessage);

  let source: EventSource | null = null;
  try {
    source = new EventSource('/api/portraits/stream');
    source.addEventListener('portrait', (event) => {
      onRecord(JSON.parse((event as MessageEvent).data) as PortraitRecord);
    });
  } catch {
    // BroadcastChannel/storage remain available when EventSource is unsupported.
  }

  const onStorage = (event: StorageEvent) => {
    if (event.key !== LOCAL_STORAGE_KEY || !event.newValue) return;
    try {
      const records = JSON.parse(event.newValue) as PortraitRecord[];
      const latest = records.at(-1);
      if (latest) onRecord(latest);
    } catch {
      // Ignore malformed external storage values.
    }
  };
  window.addEventListener('storage', onStorage);

  return () => {
    channel?.removeEventListener('message', onChannelMessage);
    source?.close();
    window.removeEventListener('storage', onStorage);
  };
}
