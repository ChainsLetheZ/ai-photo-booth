import React, { useState, useEffect } from 'react';
import BoothPage from './pages/BoothPage';
import MoveNetBenchmarkPage from './pages/MoveNetBenchmarkPage';
import WallPage from './pages/WallPage';

type AppRoute = 'benchmark' | 'booth' | 'wall';

function getRouteFromPath(): AppRoute {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  if (path === '/benchmark' || path.endsWith('/benchmark')) return 'benchmark';
  if (path === '/wall' || path.endsWith('/wall')) return 'wall';
  return 'booth';
}

const App: React.FC = () => {
  const [route, setRoute] = useState<AppRoute>(getRouteFromPath);

  useEffect(() => {
    // Normalize root URL to /booth
    const path = window.location.pathname.replace(/\/+$/, '') || '/';
    if (path === '/' || path === '') {
      window.history.replaceState(null, '', '/booth');
    }
    const onPopState = () => setRoute(getRouteFromPath());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  if (route === 'benchmark') return <MoveNetBenchmarkPage />;
  if (route === 'wall') return <WallPage />;
  return <BoothPage />;
};

export default App;
