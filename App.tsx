import React, { useState, useEffect } from 'react';
import BoothPage from './pages/BoothPage';
import FilterComparePage from './pages/FilterComparePage';
import FinalePreviewPage from './pages/FinalePreviewPage';
import MoveNetBenchmarkPage from './pages/MoveNetBenchmarkPage';
import WallPage from './pages/WallPage';

type AppRoute = 'benchmark' | 'booth' | 'filters' | 'finale' | 'wall';

function getRouteFromPath(): AppRoute {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  if (path === '/benchmark' || path.endsWith('/benchmark')) return 'benchmark';
  if (path === '/filters' || path.endsWith('/filters')) return 'filters';
  if (path === '/finale' || path.endsWith('/finale')) return 'finale';
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
  if (route === 'filters') return <FilterComparePage />;
  if (route === 'finale') return <FinalePreviewPage />;
  if (route === 'wall') return <WallPage />;
  return <BoothPage />;
};

export default App;
