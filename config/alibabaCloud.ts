const runtimeEnv: Record<string, string | undefined> = import.meta.env ?? {};

const publicAppUrl = (runtimeEnv.VITE_PUBLIC_APP_URL || '').replace(/\/$/, '');
let publicAppOrigin = '';
try {
  publicAppOrigin = publicAppUrl ? new URL(publicAppUrl).origin : '';
} catch {
  // The deployment build may use a placeholder; API helpers report it later.
}

export const isAlibabaCloudSite =
  runtimeEnv.VITE_ALIBABA_CLOUD_ENABLED === 'true' &&
  Boolean(publicAppOrigin) &&
  window.location.origin === publicAppOrigin;

export const alibabaCloudApiBase = (
  runtimeEnv.VITE_ALIBABA_CLOUD_API_URL || ''
).replace(/\/$/, '');

export function alibabaCloudApiUrl(pathname: string) {
  if (!alibabaCloudApiBase) {
    throw new Error('VITE_ALIBABA_CLOUD_API_URL is not configured');
  }
  return `${alibabaCloudApiBase}${pathname}`;
}

export function configuredPublicAppUrl() {
  return publicAppUrl;
}

export const requiresAlibabaCloudUpload =
  runtimeEnv.VITE_ALIBABA_CLOUD_ENABLED === 'true';
