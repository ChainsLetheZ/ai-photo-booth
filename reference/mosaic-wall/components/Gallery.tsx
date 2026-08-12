import React, { useRef, useState } from 'react';
import { Participant } from '../types';
import { EVENT_SLOGAN } from '../constants';

interface GalleryProps {
  isOpen: boolean;
  onClose: () => void;
  participants: Participant[];
  onDelete: (id: string) => void;
  onUpload: (files: FileList) => void;
}

export const Gallery: React.FC<GalleryProps> = ({ isOpen, onClose, participants, onDelete, onUpload }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onUpload(e.target.files);
    }
  };

  const toggleSelection = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const selectAll = () => {
    if (selectedIds.size === participants.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(participants.map((p) => p.id)));
  };

  const toggleSelectMode = () => {
    setIsSelectMode(!isSelectMode);
    setSelectedIds(new Set());
  };

  /** Download full photo without square crop or brick overlay */
  const generateDownloadBlob = (p: Participant): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(null);
        return;
      }
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = p.imageData;
      img.onload = () => {
        const maxW = 1920;
        const scale = Math.min(1, maxW / img.width);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const captionH = 72;
        canvas.width = w;
        canvas.height = h + captionH;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, w, h);
        ctx.fillStyle = '#0f172a';
        ctx.font = '700 28px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(p.vibe || EVENT_SLOGAN.primary, w / 2, h + 46);
        canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.95);
      };
      img.onerror = () => resolve(null);
    });
  };

  const handleDownloadSelected = async () => {
    if (selectedIds.size === 0) return;
    setIsDownloading(true);
    for (const id of Array.from(selectedIds)) {
      const p = participants.find((part) => part.id === id);
      if (!p) continue;
      try {
        const blob = await generateDownloadBlob(p);
        if (blob) {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `photo-${p.vibe || 'shot'}-${p.id.slice(0, 6)}.jpg`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          await new Promise((r) => setTimeout(r, 250));
        }
      } catch (e) {
        console.error('Download failed', id, e);
      }
    }
    setIsDownloading(false);
    setSelectedIds(new Set());
    setIsSelectMode(false);
  };

  return (
    <div className="fixed inset-0 z-[100] bg-slate-900/95 backdrop-blur-md flex flex-col select-none">
      <div className="flex items-center justify-between px-8 py-6 border-b border-white/10 bg-slate-900 shrink-0">
        <div className="flex items-baseline gap-4">
          <h2 className="text-3xl font-black text-white tracking-tight">GALLERY</h2>
          <span className="text-white/40 font-mono text-sm">{participants.length} PHOTOS</span>
        </div>

        <div className="flex items-center gap-4">
          {isSelectMode ? (
            <>
              <span className="text-white/60 font-mono text-xs mr-2">{selectedIds.size} Selected</span>
              <button
                onClick={selectAll}
                className="text-xs text-white/80 hover:text-white uppercase font-bold tracking-wider px-3"
              >
                {selectedIds.size === participants.length ? 'Deselect All' : 'Select All'}
              </button>
              <button
                onClick={handleDownloadSelected}
                disabled={selectedIds.size === 0 || isDownloading}
                className={`flex items-center gap-2 px-6 py-2 rounded-full font-bold uppercase tracking-wider text-xs transition-all shadow-lg ${
                  selectedIds.size === 0
                    ? 'bg-zinc-700 text-zinc-500 cursor-not-allowed'
                    : 'bg-green-600 hover:bg-green-500 text-white shadow-green-500/25'
                }`}
              >
                {isDownloading ? 'Downloading...' : 'Download'}
              </button>
              <button
                onClick={toggleSelectMode}
                className="text-xs text-red-400 hover:text-red-300 uppercase font-bold tracking-wider px-3"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                onClick={toggleSelectMode}
                className="text-xs text-white/80 hover:text-white uppercase font-bold tracking-wider px-3 border border-white/20 rounded-full py-2 hover:bg-white/5 transition-colors"
              >
                Select Photos
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-full font-bold uppercase tracking-wider text-xs transition-all shadow-lg hover:shadow-blue-500/25"
              >
                Add Photos
              </button>
            </>
          )}

          <input
            type="file"
            multiple
            accept="image/*"
            ref={fileInputRef}
            className="hidden"
            onChange={handleFileChange}
          />

          <button
            onClick={onClose}
            className="w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors ml-4"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-8">
        {participants.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-white/20">
            <p className="text-xl font-medium">No photos yet</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 pb-20">
            {participants.map((p) => {
              const isSelected = selectedIds.has(p.id);
              return (
                <div
                  key={p.id}
                  onClick={() => (isSelectMode ? toggleSelection(p.id) : null)}
                  className={`group relative aspect-video bg-slate-800 rounded-lg overflow-hidden border shadow-md cursor-pointer transition-all duration-200 ${
                    isSelectMode
                      ? isSelected
                        ? 'border-blue-500 ring-4 ring-blue-500/50 scale-95'
                        : 'border-white/5 opacity-60 hover:opacity-100'
                      : 'border-white/5 hover:border-white/30'
                  }`}
                >
                  <img src={p.imageData} alt={p.vibe} className="w-full h-full object-contain bg-black" />

                  {isSelectMode && (
                    <div
                      className={`absolute top-2 right-2 w-6 h-6 rounded-full border-2 flex items-center justify-center ${
                        isSelected ? 'bg-blue-500 border-blue-500' : 'bg-black/40 border-white/60'
                      }`}
                    >
                      {isSelected && (
                        <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                  )}

                  {!isSelectMode && (
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-between p-3">
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDelete(p.id);
                          }}
                          className="p-2 bg-red-500 hover:bg-red-600 text-white rounded-md transition-colors shadow-lg"
                          title="Delete"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                            />
                          </svg>
                        </button>
                      </div>
                      <p className="text-xs text-white/70 font-mono">{p.vibe}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
