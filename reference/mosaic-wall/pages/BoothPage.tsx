import React, { useState, useEffect } from 'react';
import { PhotoBooth } from '../components/PhotoBooth';
import { ConnectionIndicator } from '../components/ConnectionIndicator';
import { Participant } from '../types';
import { DataService } from '../services/dataService';

const BoothPage: React.FC = () => {
  const [participantCount, setParticipantCount] = useState(0);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const unsubData = DataService.subscribe((data) => {
      setParticipantCount(data.length);
    });
    const unsubConn = DataService.monitorConnection(setIsConnected);
    return () => {
      unsubData();
      unsubConn();
    };
  }, []);

  const handlePhotoComplete = (newParticipant: Participant) => {
    DataService.addParticipant(newParticipant);
  };

  return (
    <div className="relative w-full h-screen overflow-hidden bg-slate-900 font-sans">
      <ConnectionIndicator isConnected={isConnected} />
      <PhotoBooth onComplete={handlePhotoComplete} participantCount={participantCount} />
    </div>
  );
};

export default BoothPage;
