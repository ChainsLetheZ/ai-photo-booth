import React, { useState, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { MosaicView } from '../components/MosaicView';
import { Gallery } from '../components/Gallery';
import { ConnectionIndicator } from '../components/ConnectionIndicator';
import { Participant } from '../types';
import { DataService } from '../services/dataService';
import { analyzeParticipantImage } from '../services/geminiService';

const resizeImage = (base64Str: string, maxWidth = 1600): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = base64Str;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;
      if (width > maxWidth) {
        height *= maxWidth / width;
        width = maxWidth;
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      } else {
        resolve(base64Str);
      }
    };
    img.onerror = () => resolve(base64Str);
  });
};

const WallPage: React.FC = () => {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isPerformancePaused, setIsPerformancePaused] = useState(false);
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);

  useEffect(() => {
    const unsubData = DataService.subscribe(setParticipants);
    const unsubConn = DataService.monitorConnection(setIsConnected);
    return () => {
      unsubData();
      unsubConn();
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === 'g') setIsGalleryOpen((prev) => !prev);
      if (key === 'escape') setIsGalleryOpen(false);
      if (key === 'p' && !isGalleryOpen) setIsPerformancePaused((prev) => !prev);
      if (key === 'c' && e.shiftKey) DataService.clearAll();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isGalleryOpen]);

  const handleDelete = (id: string) => {
    DataService.removeParticipant(id);
  };

  const handleBatchUpload = async (fileList: FileList) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;

    const promises = files.map(async (file, index) => {
      return new Promise<Participant | null>((resolve) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
          let imageData = e.target?.result as string;
          imageData = await resizeImage(imageData);
          const analysis = await analyzeParticipantImage(imageData);
          resolve({
            id: uuidv4(),
            imageData,
            timestamp: Date.now() + index,
            vibe: analysis.vibe,
            color: analysis.color,
            isUploaded: true,
          });
        };
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
      });
    });

    const results = await Promise.all(promises);
    const valid = results.filter((p): p is Participant => p !== null);
    if (valid.length > 0) {
      DataService.addParticipantsBatch(valid);
    }
  };

  return (
    <div className="relative w-full h-screen overflow-hidden bg-[#020617] font-sans">
      <ConnectionIndicator isConnected={isConnected} />
      {isPerformancePaused && !isGalleryOpen && (
        <div className="absolute top-4 right-36 z-[200] px-3 py-1 bg-red-900/80 backdrop-blur-sm rounded-full border border-red-500/50 pointer-events-none animate-pulse">
          <span className="text-[10px] text-white font-bold tracking-widest uppercase">FX PAUSED</span>
        </div>
      )}
      <MosaicView participants={participants} isPaused={isGalleryOpen || isPerformancePaused} />
      <Gallery
        isOpen={isGalleryOpen}
        onClose={() => setIsGalleryOpen(false)}
        participants={participants}
        onDelete={handleDelete}
        onUpload={handleBatchUpload}
      />
    </div>
  );
};

export default WallPage;
