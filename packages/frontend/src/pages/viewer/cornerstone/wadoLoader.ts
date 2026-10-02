const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api/v1';

// token de autorização é injetado em runtime pelo monkey-patch em configureWadoLoader() —
// JAMAIS passar token na URL (vaza em logs/Referer)
export function buildImageIds(
  studyUID: string,
  seriesUID: string,
  sopUIDs: string[],
): string[] {
  return sopUIDs.map((sopUID) => {
    const url = `${API_BASE}/dicom/wado/studies/${studyUID}/series/${seriesUID}/instances/${sopUID}`;
    return `wadouri:${url}`;
  });
}

export function buildPortalImageIds(
  token: string,
  studyUID: string,
  seriesUID: string,
  sopUIDs: string[],
): string[] {
  const API = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api/v1';
  return sopUIDs.map((sop) =>
    `wadouri:${API}/portal/wado/${token}/${studyUID}/${seriesUID}/${sop}`
  );
}

export function configureWadoLoader(accessToken: string | null) {
  if (!accessToken) return;

  // dicom-image-loader não expõe hook de headers para wadouri, então intercepta o XHR global
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method: string, url: string, ...args: any[]) {
    (this as any).__url = url;
    return originalOpen.apply(this, [method, url, ...args] as any);
  };

  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function(...args: any[]) {
    const url = (this as any).__url ?? '';
    if (url.includes('/api/v1/') && accessToken) {
      this.setRequestHeader('Authorization', `Bearer ${accessToken}`);
    }
    return originalSend.apply(this, args as any);
  };
}
