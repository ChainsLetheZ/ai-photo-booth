import React, { useEffect, useMemo, useState } from 'react';
import BrandBar from '../components/BrandBar';
import { ENERGY_CONFIG, EVENT } from '../constants';
import { listPortraits, subscribeToPortraits } from '../services/portraitStore';
import type { PortraitRecord } from '../types';

function upsert(records: PortraitRecord[], record: PortraitRecord) {
  return [...records.filter((item) => item.id !== record.id), record].slice(-48);
}

export default function WallPage() {
  const [records, setRecords] = useState<PortraitRecord[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    listPortraits().then((items) => {
      setRecords(items);
      setConnected(true);
    });
    return subscribeToPortraits((record) => {
      setConnected(true);
      setRecords((current) => upsert(current, record));
    });
  }, []);

  const tokens = useMemo(() => records.slice(-36), [records]);
  const latest = records.at(-1);

  return (
    <main className="wall-shell">
      <BrandBar wall />
      <section className="collective-stage">
        <div className="wall-grid" />
        <div className="collective-aura aura-one" />
        <div className="collective-aura aura-two" />
        <div className="collective-core">
          <p>COLLECTIVE SIGNAL · LIVE</p>
          <h1>{EVENT.wallTitle}</h1>
          <div className="bosch-word">BOSCH</div>
          <span><strong>{records.length.toString().padStart(3, '0')}</strong> FUTURE SIGNALS CONNECTED</span>
        </div>

        <div className="portrait-field">
          {tokens.map((record, index) => {
            const ring = index % 3;
            const angle = (index * 137.5 + ring * 24) * (Math.PI / 180);
            const radius = 25 + ring * 15 + (index % 5) * 2.2;
            const x = 50 + Math.cos(angle) * radius;
            const y = 50 + Math.sin(angle) * radius * 0.64;
            const size = index === tokens.length - 1 ? 96 : 46 + (index % 4) * 9;
            return (
              <figure
                key={record.id}
                className={`portrait-token ${index === tokens.length - 1 ? 'is-latest' : ''}`}
                style={
                  {
                    left: `${x}%`,
                    top: `${y}%`,
                    width: `${size}px`,
                    height: `${size}px`,
                    '--token-color': record.color,
                    '--token-delay': `${(index % 8) * -0.6}s`,
                  } as React.CSSProperties
                }
              >
                <img src={record.imageData} alt="" />
                <i />
              </figure>
            );
          })}
        </div>

        {records.length === 0 && (
          <div className="empty-signal">
            <div className="empty-pulse" />
            <span>Waiting for the first future signal</span>
          </div>
        )}

        {latest && (
          <aside className="latest-card" key={latest.id}>
            <img src={latest.imageData} alt="Latest future portrait" />
            <div>
              <span>NEW SIGNAL JOINED</span>
              <strong>{latest.primary} × {latest.secondary}</strong>
              <p>{latest.narrative}</p>
            </div>
          </aside>
        )}

        <div className="energy-legend">
          {(Object.keys(ENERGY_CONFIG) as Array<keyof typeof ENERGY_CONFIG>).map((energy) => (
            <span key={energy}><i style={{ background: ENERGY_CONFIG[energy].color }} />{energy}</span>
          ))}
        </div>
        <div className="connection-state">
          <i className={connected ? 'status-dot' : 'status-dot muted'} />
          {connected ? 'BOOTH CONNECTED' : 'CONNECTING'}
        </div>
      </section>
    </main>
  );
}
