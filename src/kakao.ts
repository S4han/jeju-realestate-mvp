// Minimal typing for the parts of the Kakao Maps JavaScript SDK this app uses.
export type KakaoLatLng = { getLat(): number; getLng(): number };
export type KakaoMap = {
  getBounds(): { getSouthWest(): KakaoLatLng; getNorthEast(): KakaoLatLng };
  setCenter(latlng: KakaoLatLng): void;
  setLevel(level: number): void;
  relayout(): void;
};
export type KakaoMarker = { setMap(map: KakaoMap | null): void };
export type KakaoClusterer = { addMarkers(markers: KakaoMarker[]): void; clear(): void };
export type KakaoMaps = {
  load(cb: () => void): void;
  LatLng: new (lat: number, lng: number) => KakaoLatLng;
  Map: new (el: HTMLElement, opts: { center: KakaoLatLng; level: number }) => KakaoMap;
  Marker: new (opts: { position: KakaoLatLng; title?: string; clickable?: boolean }) => KakaoMarker;
  MarkerClusterer: new (opts: { map: KakaoMap; averageCenter?: boolean; minLevel?: number }) => KakaoClusterer;
  event: { addListener(target: unknown, type: string, handler: () => void): void };
};

declare global {
  interface Window {
    kakao?: { maps: KakaoMaps };
  }
}

let pending: Promise<KakaoMaps> | undefined;

// Loads the SDK once. Rejects without a key, on script error, or after a timeout so the UI can
// switch to list search (FR-008). The browser key is a public identifier restricted by domain.
export function loadKakaoMaps(appKey: string | undefined, timeoutMs = 8_000): Promise<KakaoMaps> {
  if (!appKey) return Promise.reject(new Error("NO_KEY"));
  pending ??= new Promise<KakaoMaps>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("TIMEOUT")), timeoutMs);
    const script = document.createElement("script");
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(appKey)}&autoload=false&libraries=clusterer`;
    script.async = true;
    script.onerror = () => {
      clearTimeout(timer);
      reject(new Error("SCRIPT_ERROR"));
    };
    script.onload = () => {
      const maps = window.kakao?.maps;
      if (!maps) {
        clearTimeout(timer);
        reject(new Error("SDK_MISSING"));
        return;
      }
      maps.load(() => {
        clearTimeout(timer);
        resolve(maps);
      });
    };
    document.head.appendChild(script);
  }).catch((err) => {
    pending = undefined;
    throw err;
  });
  return pending;
}
