const runtimeEnv: Record<string, string | undefined> = import.meta.env ?? {};

const defaultApiBase =
  'https://uxgs-d4gv4c7qr60f22622-1317468313.ap-shanghai.app.tcloudbase.com/photo-booth';
const defaultPublicAppUrl =
  'https://uxgs-d4gv4c7qr60f22622-1317468313.tcloudbaseapp.com/ai-photo-booth/index.html';

export const tencentCloudApiBase = (
  runtimeEnv.VITE_TENCENT_CLOUD_API_URL || defaultApiBase
).replace(/\/$/, '');

export const tencentPublicAppUrl = (
  runtimeEnv.VITE_PUBLIC_APP_URL || defaultPublicAppUrl
).replace(/\/$/, '');

let publicOrigin = '';
try {
  publicOrigin = new URL(tencentPublicAppUrl).origin;
} catch {
  // Deployment placeholders may not be valid URLs until configured.
}

export const isTencentCloudSite =
  window.location.hostname.endsWith('tcloudbaseapp.com') ||
  (Boolean(publicOrigin) && window.location.origin === publicOrigin);

export const requiresTencentCloudUpload =
  runtimeEnv.VITE_CLOUDBASE_ENABLED === 'true';

export function tencentCloudApiUrl(pathname: string) {
  return `${tencentCloudApiBase}${pathname}`;
}
