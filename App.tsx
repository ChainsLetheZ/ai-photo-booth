import React, { useState, useEffect } from 'react';
import BoothPage from './pages/BoothPage';
import WallPage from './pages/WallPage';

type AppRoute = 'booth' | 'wall';

function getRouteFromPath(): AppRoute {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
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

  if (route === 'wall') return <WallPage />;
  return <BoothPage />;
};

export default App;
