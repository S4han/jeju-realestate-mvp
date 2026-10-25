// Region choropleth on the Kakao map (P3-SCR-001/002): one polygon per eup/myeon/dong part, filled by class.
// Any SDK failure (no key, script error, timeout, missing Polygon support) reports onUnavailable so the page
// falls back to the region table (P3-FR-024).
import { useEffect, useRef } from "react";
import { loadKakaoMaps, type KakaoLatLng, type KakaoMap, type KakaoMaps } from "../kakao";
import type { Feature } from "./api";

type KakaoPolygon = { setMap(map: KakaoMap | null): void; setOptions(o: Record<string, unknown>): void };
type KakaoBounds = { extend(p: KakaoLatLng): void };
type PolygonMaps = KakaoMaps & {
  Polygon: new (o: Record<string, unknown>) => KakaoPolygon;
  LatLngBounds: new () => KakaoBounds;
};

const FIT_MAX_LAT = 33.62;

export type RegionStyle = { fill: string; opacity: number; dashed: boolean };

export function RegionMap(props: {
  appKey: string | undefined;
  features: Feature[];
  styleOf: (regionId: string) => RegionStyle;
  selectedId: string | null;
  onSelect: (regionId: string) => void;
  onUnavailable: () => void;
}) {
  const { appKey, features, styleOf, selectedId, onSelect, onUnavailable } = props;
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<{ maps: PolygonMaps; map: KakaoMap } | null>(null);
  const polygons = useRef<{ id: string; p: KakaoPolygon }[]>([]);
  const select = useRef(onSelect);
  select.current = onSelect;

  useEffect(() => {
    let cancelled = false;
    loadKakaoMaps(appKey)
      .then((maps) => {
        if (cancelled || !el.current) return;
        const m = maps as PolygonMaps;
        if (typeof m.Polygon !== "function" || typeof m.LatLngBounds !== "function") throw new Error("NO_POLYGON");
        mapRef.current = { maps: m, map: new m.Map(el.current, { center: new m.LatLng(33.38, 126.55), level: 10 }) };
        drawRef.current();
      })
      .catch(() => !cancelled && onUnavailable());
    return () => {
      cancelled = true;
    };
  }, [appKey, onUnavailable]);

  // (Re)draw whenever the features or their styles change; fit the view to the features.
  const drawRef = useRef(() => {});
  drawRef.current = () => {
    const ctx = mapRef.current;
    if (!ctx) return;
    const { maps, map } = ctx;
    for (const { p } of polygons.current) p.setMap(null);
    polygons.current = [];
    const bounds = new maps.LatLngBounds();
    for (const f of features) {
      const s = styleOf(f.id);
      const selected = f.id === selectedId;
      for (const poly of f.geometry.coordinates) {
        const path = poly[0]!.map(([lng, lat]) => {
          const ll = new maps.LatLng(lat!, lng!);
          // Chuja islands (~33.9°N) are drawn but left out of the fit so the main island stays readable.
          if (lat! < FIT_MAX_LAT) bounds.extend(ll);
          return ll;
        });
        const p = new maps.Polygon({
          map,
          path,
          fillColor: s.fill,
          fillOpacity: s.opacity,
          strokeColor: selected ? "#0f172a" : "#ffffff",
          strokeWeight: selected ? 3 : 1,
          strokeOpacity: 0.9,
          strokeStyle: s.dashed && !selected ? "dash" : "solid",
        });
        maps.event.addListener(p, "click", () => select.current(f.id));
        polygons.current.push({ id: f.id, p });
      }
    }
    if (features.length) (map as KakaoMap & { setBounds(b: KakaoBounds): void }).setBounds(bounds);
  };
  const key = features.map((f) => f.id).join(",");
  useEffect(() => {
    drawRef.current();
    // Styles depend on statistics; the parent passes a new styleOf when they change.
  }, [key, styleOf, selectedId]);

  return <div ref={el} className="h-full w-full" aria-label="지역 지도" role="application" />;
}
