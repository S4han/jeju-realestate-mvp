import { useEffect, useRef, useState } from "react";
import { fetchMarkers, type CityCode } from "../api";
import { loadKakaoMaps, type KakaoClusterer, type KakaoMap, type KakaoMaps } from "../kakao";

type Props = {
  appKey: string | undefined;
  city: CityCode | "";
  focus: { lat: number; lng: number; seq: number } | null;
  onSelect: (id: string) => void;
  onUnavailable: (reason: string) => void;
};

const JEJU_CENTER = { lat: 33.38, lng: 126.55 };

// Jeju map with markers for the visible bounds only (FR-004~006). Any SDK failure is reported up
// so the app can switch to list search (FR-008).
export function MapView({ appKey, city, focus, onSelect, onUnavailable }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const sdk = useRef<{ maps: KakaoMaps; map: KakaoMap; clusterer: KakaoClusterer } | null>(null);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const refresh = useRef<() => void>(() => {});

  useEffect(() => {
    let cancelled = false;
    loadKakaoMaps(appKey)
      .then((maps) => {
        if (cancelled || !el.current) return;
        const map = new maps.Map(el.current, { center: new maps.LatLng(JEJU_CENTER.lat, JEJU_CENTER.lng), level: 10 });
        const clusterer = new maps.MarkerClusterer({ map, averageCenter: true, minLevel: 6 });
        sdk.current = { maps, map, clusterer };
        let timer: ReturnType<typeof setTimeout> | undefined;
        maps.event.addListener(map, "idle", () => {
          clearTimeout(timer);
          timer = setTimeout(() => refresh.current(), 300);
        });
        setReady(true);
      })
      .catch((e: Error) => !cancelled && onUnavailable(e.message));
    return () => {
      cancelled = true;
    };
  }, [appKey, onUnavailable]);

  // Re-query markers for the current bounds (and when the city filter changes).
  useEffect(() => {
    let ctrl: AbortController | undefined;
    refresh.current = () => {
      const s = sdk.current;
      if (!s) return;
      ctrl?.abort();
      ctrl = new AbortController();
      const b = s.map.getBounds();
      const sw = b.getSouthWest();
      const ne = b.getNorthEast();
      fetchMarkers([sw.getLng(), sw.getLat(), ne.getLng(), ne.getLat()], city, ctrl.signal)
        .then((r) => {
          s.clusterer.clear();
          s.clusterer.addMarkers(
            r.items.map((m) => {
              const marker = new s.maps.Marker({ position: new s.maps.LatLng(m.lat, m.lng), title: m.name, clickable: true });
              s.maps.event.addListener(marker, "click", () => onSelect(m.id));
              return marker;
            }),
          );
          setNotice(r.truncated ? "단지가 많아 일부만 표시합니다. 지도를 확대해 주세요." : null);
        })
        .catch((e) => {
          if ((e as Error).name !== "AbortError") setNotice("단지 위치를 불러오지 못했습니다. 검색은 계속 이용할 수 있습니다.");
        });
    };
    if (ready) refresh.current();
    return () => ctrl?.abort();
  }, [city, ready, onSelect]);

  useEffect(() => {
    const s = sdk.current;
    if (!s || !focus) return;
    s.map.setLevel(4);
    s.map.setCenter(new s.maps.LatLng(focus.lat, focus.lng));
  }, [focus, ready]);

  return (
    <div className="relative h-full w-full">
      <div ref={el} data-testid="map" className="h-full w-full bg-slate-200" />
      {!ready && <div className="absolute inset-0 grid place-items-center text-sm text-slate-500">지도를 불러오는 중…</div>}
      {notice && <div role="status" className="pointer-events-none absolute inset-x-3 top-3 rounded-lg bg-white/95 px-3 py-2 text-xs shadow">{notice}</div>}
    </div>
  );
}
