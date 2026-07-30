import React from 'react';

export default function SignalField({ active = false }: { active?: boolean }) {
  return (
    <div className={`signal-field ${active ? 'is-active' : ''}`} aria-hidden="true">
      <span className="signal-orbit orbit-one" />
      <span className="signal-orbit orbit-two" />
      <span className="signal-orbit orbit-three" />
      {Array.from({ length: 14 }, (_, index) => (
        <i
          key={index}
          style={
            {
              '--signal-angle': `${index * 25.7}deg`,
              '--signal-delay': `${index * -0.18}s`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
