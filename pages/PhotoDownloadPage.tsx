import React, { useEffect, useState } from 'react';
import type { WallEntry } from '../types';
import {
  isTencentCloudSite,
  tencentCloudApiUrl,
} from '../config/tencentCloud';

export default function PhotoDownloadPage() {
  const assetBase = import.meta.env.BASE_URL ?? '/';
  const claimToken =
    new URLSearchParams(window.location.search).get('photo') ||
    window.location.pathname.split('/').filter(Boolean).at(-1) ||
    '';
  const [entry, setEntry] = useState<WallEntry | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing'>('loading');
  const apiBase = isTencentCloudSite
    ? tencentCloudApiUrl('/photos')
    : '/api/photos';

  useEffect(() => {
    let cancelled = false;
    fetch(`${apiBase}/${encodeURIComponent(claimToken)}`, { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error('Photo not found');
        return response.json() as Promise<WallEntry>;
      })
      .then((photo) => {
        if (cancelled) return;
        setEntry(photo);
        setStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setStatus('missing');
      });
    return () => {
      cancelled = true;
    };
  }, [claimToken]);

  return (
    <main className="photo-download-page">
      <img
        className="photo-download-supergraphic"
        src={`${assetBase}brand/supergraphic-responsive.svg`}
        alt=""
        aria-hidden="true"
      />
      <section className="photo-download-card">
        <header className="photo-download-header">
          <img
            className="photo-download-logo"
            src={`${assetBase}brand/bosch-logo.svg`}
            alt="Bosch"
          />
          <span className="photo-download-header-label">SUPPLIER DAY 2026</span>
        </header>
        {status === 'loading' && <p className="photo-download-status">照片加载中…</p>}
        {status === 'missing' && (
          <div className="photo-download-empty">
            <h1>暂时找不到这张照片</h1>
            <p>请确认拍照端已显示“扫码下载”，然后重新扫码。</p>
          </div>
        )}
        {entry && (
          <>
            <p className="photo-download-kicker">SUPPLIER DAY 2026 · {entry.shortCode}</p>
            <h1>你的未来照片已生成</h1>
            <img className="photo-download-image" src={entry.imageUrl} alt="你的活动照片" />
            <a className="photo-download-button" href={`${apiBase}/${entry.claimToken}/download`}>
              下载高清照片
            </a>
            <p className="photo-download-hint">iPhone 可长按照片保存；活动结束后请及时下载。</p>
          </>
        )}
      </section>
    </main>
  );
}
