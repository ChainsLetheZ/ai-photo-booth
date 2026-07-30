import React from 'react';
import { EVENT } from '../constants';

export default function BrandBar({ wall = false }: { wall?: boolean }) {
  return (
    <header className="brand-bar">
      <a className="bosch-mark" href={wall ? '/wall' : '/booth'} aria-label="Bosch Supplier Conference">
        <span className="bosch-symbol" aria-hidden="true">
          <span />
        </span>
        <span>BOSCH</span>
      </a>
      <div className="brand-event">
        <span>{EVENT.eyebrow}</span>
        <strong>{wall ? 'COLLECTIVE SIGNAL' : EVENT.title}</strong>
      </div>
      <div className="brand-spectrum" aria-hidden="true">
        {['#9E2896', '#50237F', '#00629A', '#00A8E0', '#00884A', '#7AB51D', '#F5A623', '#E20015'].map(
          (color) => <i key={color} style={{ background: color }} />,
        )}
      </div>
    </header>
  );
}
