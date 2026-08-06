import fs from 'fs';
import path from 'path';
import { wallConfig } from '../config/wallConfig';
import type { WallEntry, WallEntrySubmission } from '../types';
import {
  decodeDataUrl,
  isDataUrl,
  isWallMediaUrl,
  mediaBaseName,
  wallMediaDirectory,
  writeWallImage,
} from './wallMedia';

/**
 * Version 4 stores one image per entry. Earlier versions carried a separate
 * full-resolution `photoUrl` alongside `thumbUrl`, both holding the same bytes
 * and neither ever displayed at full size; version 2 also kept those bytes
 * inline as base64. Both older shapes are still readable and are converted the
 * first time the store is opened.
 */
interface PersistedWallState {
  version: 4;
  nextShortCode: number;
  entries: WallEntry[];
  reservations: Record<string, string>;
}

function emptyState(): PersistedWallState {
  return {
    version: 4,
    nextShortCode: wallConfig.firstShortCode,
    entries: [],
    reservations: {},
  };
}

function isStorableImageUrl(value: unknown): value is string {
  return (
    typeof value === 'string' && (isDataUrl(value) || isWallMediaUrl(value))
  );
}

interface LegacyImageFields {
  thumbUrl?: unknown;
  photoUrl?: unknown;
}

/** Folds an older entry's two image fields into the single one. */
function withImageUrl(raw: unknown) {
  if (!raw || typeof raw !== 'object') return raw;
  const entry = raw as Partial<WallEntry> & LegacyImageFields;
  if (isStorableImageUrl(entry.imageUrl)) return entry;
  const legacy = isStorableImageUrl(entry.thumbUrl)
    ? entry.thumbUrl
    : entry.photoUrl;
  const { thumbUrl, photoUrl, ...rest } = entry;
  return isStorableImageUrl(legacy) ? { ...rest, imageUrl: legacy } : rest;
}

function isWallEntry(value: unknown): value is WallEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<WallEntry>;
  return (
    typeof entry.id === 'string' &&
    /^\d{3,}$/.test(entry.shortCode ?? '') &&
    typeof entry.createdAt === 'number' &&
    isStorableImageUrl(entry.imageUrl) &&
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
  private readonly mediaDirectory: string;
  /** Set by `read()` when the file on disk was written by an older version. */
  private upgradedOnRead = false;

  constructor(private readonly filePath: string) {
    this.mediaDirectory = wallMediaDirectory(filePath);
    this.state = this.read();
    if (this.migrateInlineImages() || this.upgradedOnRead) this.write();
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
    // The image lands on disk before the entry exists, so a failed write can
    // never leave a stored entry pointing at a file that is not there.
    const entry: WallEntry = {
      ...entryDraft,
      imageUrl: this.storeImage(draft.id, entryDraft.imageUrl),
      shortCode: this.reserve(draft.id, requestedShortCode),
      createdAt: Date.now(),
    };
    this.state.entries.push(entry);
    this.write();
    return { entry, added: true };
  }

  /**
   * Accepts either form: a data URL is written out and replaced by its URL, an
   * already stored URL passes through so a replayed submission is idempotent.
   */
  private storeImage(id: string, value: string) {
    if (isWallMediaUrl(value)) return value;
    const image = decodeDataUrl(value);
    if (!image) throw new Error('WALL_MEDIA_INVALID');
    return writeWallImage(this.mediaDirectory, mediaBaseName(id), image);
  }

  /** Moves any version 2 inline base64 entry onto disk. */
  private migrateInlineImages() {
    let changed = false;
    for (const entry of this.state.entries) {
      if (!isDataUrl(entry.imageUrl)) continue;
      try {
        entry.imageUrl = this.storeImage(entry.id, entry.imageUrl);
        changed = true;
      } catch {
        // An undecodable legacy entry keeps its inline data rather than being
        // dropped; the wall can still render it.
      }
    }
    return changed;
  }

  private read(): PersistedWallState {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as
        | Partial<PersistedWallState>
        | WallEntry[];
      if (Array.isArray(parsed)) {
        this.upgradedOnRead = true;
        const entries = parsed
          .map((entry) => ({ ...entry, poseTrace: [], poseTraceVersion: 2 as const }))
          .map(withImageUrl)
          .filter(isWallEntry)
          .slice(0, wallConfig.capacity);
        const maxCode = entries.reduce(
          (maximum, entry) => Math.max(maximum, Number(entry.shortCode)),
          wallConfig.firstShortCode - 1,
        );
        return {
          version: 4,
          nextShortCode: maxCode + 1,
          entries,
          reservations: Object.fromEntries(
            entries.map((entry) => [entry.id, entry.shortCode]),
          ),
        };
      }
      // Pose traces and reservations both arrived in version 2, so every
      // version at or above it carries them through untouched.
      const storedVersion = Number(parsed.version) || 1;
      if (storedVersion < 4) this.upgradedOnRead = true;
      const entries = Array.isArray(parsed.entries)
        ? parsed.entries
            .map((entry) =>
              storedVersion >= 2
                ? entry
                : { ...entry, poseTrace: [], poseTraceVersion: 2 as const },
            )
            .map(withImageUrl)
            .filter(isWallEntry)
            .slice(0, wallConfig.capacity)
        : [];
      const maxCode = entries.reduce(
        (maximum, entry) => Math.max(maximum, Number(entry.shortCode)),
        wallConfig.firstShortCode - 1,
      );
      return {
        version: 4,
        nextShortCode: Math.max(
          Number(parsed.nextShortCode) || wallConfig.firstShortCode,
          maxCode + 1,
        ),
        entries,
        reservations: {
          ...Object.fromEntries(entries.map((entry) => [entry.id, entry.shortCode])),
          ...(storedVersion >= 2 && parsed.reservations
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
