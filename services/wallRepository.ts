import fs from 'fs';
import path from 'path';
import { wallConfig } from '../config/wallConfig';
import type { WallEntry, WallEntrySubmission } from '../types';

interface PersistedWallState {
  version: 2;
  nextShortCode: number;
  entries: WallEntry[];
  reservations: Record<string, string>;
}

function emptyState(): PersistedWallState {
  return {
    version: 2,
    nextShortCode: wallConfig.firstShortCode,
    entries: [],
    reservations: {},
  };
}

function isWallEntry(value: unknown): value is WallEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<WallEntry>;
  return (
    typeof entry.id === 'string' &&
    /^\d{3,}$/.test(entry.shortCode ?? '') &&
    typeof entry.createdAt === 'number' &&
    typeof entry.photoUrl === 'string' &&
    entry.photoUrl.startsWith('data:image/') &&
    typeof entry.thumbUrl === 'string' &&
    entry.thumbUrl.startsWith('data:image/') &&
    typeof entry.primaryEnergy === 'string' &&
    typeof entry.secondaryDimension === 'string' &&
    typeof entry.narrativeLine === 'string' &&
    Number.isInteger(entry.personCount) &&
    Array.isArray(entry.poseTrace)
    && entry.poseTraceVersion === 2
  );
}

export class WallRepository {
  private state: PersistedWallState;

  constructor(private readonly filePath: string) {
    this.state = this.read();
  }

  list(): WallEntry[] {
    return [...this.state.entries].sort(
      (left, right) => left.createdAt - right.createdAt,
    );
  }

  reserve(id: string, requestedShortCode?: string): string {
    const existingEntry = this.state.entries.find((entry) => entry.id === id);
    if (existingEntry) return existingEntry.shortCode;
    const existing = this.state.reservations[id];
    if (existing) return existing;

    const usedCodes = new Set([
      ...this.state.entries.map((entry) => entry.shortCode),
      ...Object.values(this.state.reservations),
    ]);
    const lastShortCode =
      wallConfig.firstShortCode + wallConfig.capacity - 1;
    const requested = Number(requestedShortCode);
    const canUseRequested =
      Number.isInteger(requested) &&
      requested >= wallConfig.firstShortCode &&
      requested <= lastShortCode &&
      !usedCodes.has(String(requested).padStart(3, '0'));
    let next = canUseRequested ? requested : this.state.nextShortCode;
    while (
      next <= lastShortCode &&
      usedCodes.has(String(next).padStart(3, '0'))
    ) {
      next += 1;
    }
    if (next > lastShortCode) throw new Error('WALL_CAPACITY_REACHED');
    const shortCode = String(next).padStart(3, '0');
    this.state.reservations[id] = shortCode;
    this.state.nextShortCode = Math.max(this.state.nextShortCode, next + 1);
    this.write();
    return shortCode;
  }

  add(draft: WallEntrySubmission): { entry: WallEntry; added: boolean } {
    const existing = this.state.entries.find((entry) => entry.id === draft.id);
    if (existing) return { entry: existing, added: false };
    if (this.state.entries.length >= wallConfig.capacity) {
      throw new Error('WALL_CAPACITY_REACHED');
    }

    const { requestedShortCode, ...entryDraft } = draft;
    const entry: WallEntry = {
      ...entryDraft,
      shortCode: this.reserve(draft.id, requestedShortCode),
      createdAt: Date.now(),
    };
    this.state.entries.push(entry);
    this.write();
    return { entry, added: true };
  }

  private read(): PersistedWallState {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as
        | Partial<PersistedWallState>
        | WallEntry[];
      if (Array.isArray(parsed)) {
        const entries = parsed
          .map((entry) => ({ ...entry, poseTrace: [], poseTraceVersion: 2 as const }))
          .filter(isWallEntry)
          .slice(0, wallConfig.capacity);
        const maxCode = entries.reduce(
          (maximum, entry) => Math.max(maximum, Number(entry.shortCode)),
          wallConfig.firstShortCode - 1,
        );
        return {
          version: 2,
          nextShortCode: maxCode + 1,
          entries,
          reservations: Object.fromEntries(
            entries.map((entry) => [entry.id, entry.shortCode]),
          ),
        };
      }
      const entries = Array.isArray(parsed.entries)
        ? parsed.entries
            .map((entry) =>
              parsed.version === 2
                ? entry
                : { ...entry, poseTrace: [], poseTraceVersion: 2 as const },
            )
            .filter(isWallEntry)
            .slice(0, wallConfig.capacity)
        : [];
      const maxCode = entries.reduce(
        (maximum, entry) => Math.max(maximum, Number(entry.shortCode)),
        wallConfig.firstShortCode - 1,
      );
      return {
        version: 2,
        nextShortCode: Math.max(
          Number(parsed.nextShortCode) || wallConfig.firstShortCode,
          maxCode + 1,
        ),
        entries,
        reservations: {
          ...Object.fromEntries(entries.map((entry) => [entry.id, entry.shortCode])),
          ...(parsed.version === 2 && parsed.reservations
            ? parsed.reservations
            : {}),
        },
      };
    } catch {
      return emptyState();
    }
  }

  private write() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(this.state), 'utf8');
    fs.renameSync(tempPath, this.filePath);
  }
}
