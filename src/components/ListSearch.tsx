import { useEffect, useState } from "react";
import { searchApartments, type ApartmentListItem, type CityCode } from "../api";
import { CITY_LABEL, displayAddress } from "../format";

type Props = { city: CityCode | ""; onSelect: (item: ApartmentListItem) => void };

// List-based search shown when the map is unavailable (SCR-004 / FR-008).
export function ListSearch({ city, onSelect }: Props) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<ApartmentListItem[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setItems(null);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      searchApartments(term, city, ctrl.signal)
        .then((r) => {
          setItems(r.items);
          setError(false);
        })
        .catch((e) => (e as Error).name !== "AbortError" && setError(true));
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, city]);

  return (
    <div className="p-4">
      <label className="block text-sm font-medium" htmlFor="list-q">
        아파트명으로 찾기
      </label>
      <input
        id="list-q"
        type="search"
        value={q}
        maxLength={30}
        onChange={(e) => setQ(e.target.value)}
        placeholder="예: 노형, 부영, 아라"
        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
      />
      {error && <p className="mt-3 text-sm text-red-700">검색 서버에 연결할 수 없습니다.</p>}
      {items && items.length === 0 && <p className="mt-3 text-sm text-slate-500">일치하는 아파트가 없습니다.</p>}
      <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
        {(items ?? []).map((it) => (
          <li key={it.id}>
            <button type="button" onClick={() => onSelect(it)} className="block w-full px-3 py-3 text-left hover:bg-slate-50">
              <span className="block text-sm font-medium">{it.name}</span>
              <span className="block text-xs text-slate-500">
                {CITY_LABEL[it.city_code]} · {displayAddress(it.road_address, it.lot_address)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
