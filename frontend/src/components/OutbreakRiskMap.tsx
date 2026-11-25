import { CircleMarker, MapContainer, Popup, TileLayer } from "react-leaflet";
import { Badge } from "@/components/ui/primitives";

const RISK_COLORS: Record<string, string> = {
  low: "#15803D",
  moderate: "#EAB308",
  high: "#EA580C",
  critical: "#B91C1C",
  insufficient_data: "#64748B",
};

interface OutbreakRegionPoint {
  region_id: number;
  region_name: string;
  state: string;
  latitude: number;
  longitude: number;
  population?: number | null;
  risk_level: "low" | "moderate" | "high" | "critical" | "insufficient_data" | string;
  risk_score: number | null;
  outbreak_probability: number | null;
  observed_cases_recent: number;
  observed_deaths_recent: number;
  target_period?: string | null;
  feature_importances?: Array<{ label: string; importance: number }>;
  confidence_or_uncertainty?: string;
}

export function OutbreakRiskMap({
  predictions,
  selectedRegionId,
  onSelectRegion,
}: {
  predictions: OutbreakRegionPoint[];
  selectedRegionId: number | null;
  onSelectRegion: (id: number) => void;
}) {
  const validPoints = predictions.filter(
    (p) => typeof p.latitude === "number" && typeof p.longitude === "number" && !Number.isNaN(p.latitude) && !Number.isNaN(p.longitude)
  );
  const center: [number, number] =
    validPoints.length > 0
      ? [validPoints[0].latitude, validPoints[0].longitude]
      : [22.9734, 78.6569];

  return (
    <div className="h-[380px] w-full overflow-hidden rounded-lg border border-border">
      <MapContainer center={center} zoom={5} scrollWheelZoom={false} className="h-full w-full">
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {validPoints.map((r) => {
          const color = RISK_COLORS[r.risk_level] || "#64748B";
          const isSelected = selectedRegionId === r.region_id;
          const radius =
            r.risk_level === "insufficient_data" || r.risk_score === null
              ? 8
              : Math.max(9, Math.min(22, Math.round(r.risk_score / 4.5)));
          const badgeVariant = (
            ["low", "moderate", "high", "critical", "insufficient_data"].includes(r.risk_level)
              ? r.risk_level
              : "insufficient_data"
          ) as "low" | "moderate" | "high" | "critical" | "insufficient_data";

          return (
            <CircleMarker
              key={r.region_id}
              center={[r.latitude, r.longitude]}
              radius={radius}
              pathOptions={{
                color: isSelected ? "#0F2744" : color,
                weight: isSelected ? 3 : 1.5,
                fillColor: color,
                fillOpacity: r.risk_level === "insufficient_data" ? 0.35 : 0.55,
              }}
              eventHandlers={{
                click: () => onSelectRegion(r.region_id),
              }}
            >
              <Popup>
                <div className="flex min-w-[210px] flex-col gap-1.5 text-xs text-slate-900">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-950">{r.region_name}</span>
                    <Badge variant={badgeVariant}>
                      {r.risk_level === "insufficient_data" ? "INSUFFICIENT DATA" : r.risk_level.toUpperCase()}
                    </Badge>
                  </div>
                  <div>State: {r.state}</div>
                  <div>
                    Risk Score:{" "}
                    <span className="font-mono font-semibold">
                      {r.risk_score !== null ? `${r.risk_score}/100` : "Insufficient Data"}
                    </span>
                  </div>
                  <div>
                    Observed Cases / Deaths:{" "}
                    <span className="font-mono font-semibold">
                      {r.observed_cases_recent} / {r.observed_deaths_recent}
                    </span>
                  </div>
                  {r.population ? (
                    <div>Population (Geocoded): {r.population.toLocaleString()}</div>
                  ) : null}
                  {r.feature_importances?.[0]?.label ? (
                    <div>
                      Top Model Driver: <span className="font-medium">{r.feature_importances[0].label}</span>
                    </div>
                  ) : null}
                  {r.confidence_or_uncertainty ? (
                    <div className="text-[11px] text-muted-foreground">{r.confidence_or_uncertainty}</div>
                  ) : null}
                </div>
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>
    </div>
  );
}
