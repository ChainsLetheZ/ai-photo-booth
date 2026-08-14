import React, { useState, useEffect } from 'react';
import BoothPage from './pages/BoothPage';
import FilterComparePage from './pages/FilterComparePage';
import FinalePreviewPage from './pages/FinalePreviewPage';
import MoveNetBenchmarkPage from './pages/MoveNetBenchmarkPage';
import WallPage from './pages/WallPage';
import PhotoDownloadPage from './pages/PhotoDownloadPage';
import { isTencentCloudSite } from './config/tencentCloud';

type AppRoute = 'benchmark' | 'booth' | 'filters' | 'finale' | 'photo' | 'wall';

function getRouteFromPath(): AppRoute {
  const query = new URLSearchParams(window.location.search);
  if (query.get('view') === 'wall') return 'wall';
  if (query.has('photo')) return 'photo';
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  if (path === '/benchmark' || path.endsWith('/benchmark')) return 'benchmark';
  if (path === '/filters' || path.endsWith('/filters')) return 'filters';
  if (path === '/finale' || path.endsWith('/finale')) return 'finale';
  if (path === '/wall' || path.endsWith('/wall')) return 'wall';
  if (/\/photo\/[^/]+$/.test(path)) return 'photo';
  return 'booth';
}

const App: React.FC = () => {
  const [route, setRoute] = useState<AppRoute>(getRouteFromPath);

  useEffect(() => {
    // Normalize root URL to /booth
    const path = window.location.pathname.replace(/\/+$/, '') || '/';
    if (!isTencentCloudSite && (path === '/' || path === '')) {
      window.history.replaceState(null, '', '/booth');
    }
    const onPopState = () => setRoute(getRouteFromPath());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  if (isTencentCloudSite && route === 'booth') {
    return (
      <main className="cloud-booth-warning">
        <h1>这里不是拍照端</h1>
        <p>拍照电脑请打开本地地址：</p>
        <a href="http://localhost:3000/booth">http://localhost:3000/booth</a>
        <p>腾讯云页面只用于大屏照片墙和手机扫码下载。</p>
      </main>
    );
  }
  if (route === 'benchmark') return <MoveNetBenchmarkPage />;
  if (route === 'filters') return <FilterComparePage />;
  if (route === 'finale') return <FinalePreviewPage />;
  if (route === 'wall') return <WallPage />;
  if (route === 'photo') return <PhotoDownloadPage />;
  return <BoothPage />;
};

export default App;
