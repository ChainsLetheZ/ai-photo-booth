import { wallConfig } from '../config/wallConfig';
import type {
  PortraitRecord,
  WallEntry,
  WallEntryDraft,
  WallEntrySubmission,
  WallSocketMessage,
} from '../types';

const channel =
  typeof BroadcastChannel !== 'undefined'
    ? new BroadcastChannel('bosch-collective-wall')
    : null;

function readLocal(): WallEntry[] {
  try {
    const value = JSON.parse(
      localStorage.getItem(wallConfig.localFallbackKey) || '[]',
    );
    return Array.isArray(value) ? (value as WallEntry[]) : [];
  } catch {
    return [];
  }
}

function writeLocal(records: WallEntry[]) {
  let recent = records.slice(-wallConfig.capacity);
  while (recent.length > 0) {
    try {
      localStorage.setItem(wallConfig.localFallbackKey, JSON.stringify(recent));
      return;
    } catch {
      recent = recent.slice(1);
    }
  }
}

function readLocalReservations(): Record<string, string> {
  try {
    const value = JSON.parse(
      localStorage.getItem(wallConfig.reservationFallbackKey) || '{}',
    );
    return value && typeof value === 'object'
      ? (value as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}

function writeLocalReservations(reservations: Record<string, string>) {
  try {
    localStorage.setItem(
      wallConfig.reservationFallbackKey,
      JSON.stringify(reservations),
    );
  } catch {
    // A server reservation remains authoritative when localStorage is full.
  }
}

function upsert(records: WallEntry[], entry: WallEntry) {
  return [...records.filter((item) => item.id !== entry.id), entry]
    .sort((left, right) => left.createdAt - right.createdAt)
    .slice(-wallConfig.capacity);
}

function portraitToDraft(record: PortraitRecord): WallEntrySubmission {
  const fallbackCount =
    record.mode === 'Single' ? 1 : record.mode === 'Pair' ? 2 : 3;
  return {
    id: record.id,
    photoUrl: record.imageData,
    thumbUrl: record.imageData,
    primaryEnergy: record.primary,
    secondaryDimension: record.secondary,
    narrativeLine: record.narrative,
    personCount: Math.max(1, Math.min(5, record.personCount ?? fallbackCount)),
    poseTrace: record.poseTrace ?? [],
    poseTraceVersion: 2,
    requestedShortCode: record.shortCode,
  };
}

export async function listWallEntries(): Promise<WallEntry[]> {
  try {
    const response = await fetch('/api/wall/entries', { cache: 'no-store' });
    if (!response.ok) throw new Error('Wall service unavailable');
    const records = (await response.json()) as WallEntry[];
    writeLocal(records);
    return records;
  } catch {
    return readLocal();
  }
}

export async function reserveWallCode(id: string): Promise<string> {
  const reservations = readLocalReservations();
  if (reservations[id]) return reservations[id];
  try {
    const response = await fetch('/api/wall/codes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (!response.ok) throw new Error('Unable to reserve wall code');
    const result = (await response.json()) as { shortCode: string };
    reservations[id] = result.shortCode;
    writeLocalReservations(reservations);
    return result.shortCode;
  } catch {
    const used = [
      ...Object.values(reservations).map(Number),
      ...readLocal().map((entry) => Number(entry.shortCode)),
    ].filter(Number.isFinite);
    const nextCode = Math.max(
      wallConfig.firstShortCode,
      ...(used.map((code) => code + 1)),
    );
    const lastCode = wallConfig.firstShortCode + wallConfig.capacity - 1;
    if (nextCode > lastCode) throw new Error('Wall number capacity reached');
    const shortCode = String(nextCode).padStart(3, '0');
    reservations[id] = shortCode;
    writeLocalReservations(reservations);
    return shortCode;
  }
}

export async function publishPortrait(record: PortraitRecord): Promise<WallEntry> {
  const draft = portraitToDraft(record);
  try {
    const response = await fetch('/api/wall/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    });
    if (!response.ok) throw new Error('Unable to add portrait to the wall');
    const entry = (await response.json()) as WallEntry;
    writeLocal(upsert(readLocal(), entry));
    channel?.postMessage(entry);
    return entry;
  } catch {
    // Preserve the existing same-device fallback: a temporary server outage
    // must not leave the result-page action stuck in its publishing state.
    const local = readLocal();
    const { requestedShortCode, ...fallbackDraft } = draft;
    const nextCode = requestedShortCode
      ? Number(requestedShortCode)
      : Math.max(
          wallConfig.firstShortCode,
          ...local.map((entry) => Number(entry.shortCode) + 1),
        );
    const fallback: WallEntry = {
      ...fallbackDraft,
      shortCode: String(nextCode).padStart(3, '0'),
      createdAt: Date.now(),
    };
    writeLocal(upsert(local, fallback));
    channel?.postMessage(fallback);
    return fallback;
  }
}

export function subscribeToWallEntries(
  onEntry: (entry: WallEntry) => void,
  onSync: (entries: WallEntry[]) => void,
  onConnectionChange?: (connected: boolean) => void,
) {
  let socket: WebSocket | null = null;
  let stopped = false;
  let reconnectDelay: number = wallConfig.reconnect.initialDelayMs;
  let reconnectTimer: number | null = null;

  const applySync = (entries: WallEntry[]) => {
    const sorted = entries
      .sort((left, right) => left.createdAt - right.createdAt)
      .slice(-wallConfig.capacity);
    writeLocal(sorted);
    onSync(sorted);
  };

  const connect = () => {
    if (stopped) return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(
      `${protocol}//${window.location.host}${wallConfig.websocketPath}`,
    );
    socket.addEventListener('open', () => {
      reconnectDelay = wallConfig.reconnect.initialDelayMs;
      onConnectionChange?.(true);
    });
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as WallSocketMessage;
      if (message.type === 'sync') applySync(message.entries);
      if (message.type === 'entry_added') {
        writeLocal(upsert(readLocal(), message.entry));
        onEntry(message.entry);
      }
    });
    socket.addEventListener('close', () => {
      onConnectionChange?.(false);
      if (stopped) return;
      reconnectTimer = window.setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(
        reconnectDelay * 2,
        wallConfig.reconnect.maxDelayMs,
      );
    });
    socket.addEventListener('error', () => socket?.close());
  };

  const onChannelMessage = (event: MessageEvent<WallEntry>) => {
    onEntry(event.data);
  };
  channel?.addEventListener('message', onChannelMessage);
  connect();

  return () => {
    stopped = true;
    if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
    channel?.removeEventListener('message', onChannelMessage);
    socket?.close();
  };
}
