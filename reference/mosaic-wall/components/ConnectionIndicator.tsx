import React from 'react';

interface ConnectionIndicatorProps {
  isConnected: boolean;
}

export const ConnectionIndicator: React.FC<ConnectionIndicatorProps> = ({ isConnected }) => (
  <div className="absolute top-4 right-4 z-[200] flex items-center gap-2 px-3 py-1 bg-black/40 backdrop-blur-sm rounded-full pointer-events-none">
    <div
      className={`w-2 h-2 rounded-full ${
        isConnected ? 'bg-green-500 shadow-[0_0_8px_#22c55e]' : 'bg-red-500 animate-pulse'
      }`}
    />
    <span className="text-[10px] text-white/70 font-mono tracking-widest uppercase">
      {isConnected ? 'LIVE SYNC' : 'OFFLINE'}
    </span>
  </div>
);
