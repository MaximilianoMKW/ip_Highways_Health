import { along, lineString, length } from "@turf/turf";

export type RoadStatus = "ok" | "warning" | "critical";
export type MapFilter = "all" | "warning" | "critical";

export type Coordinate = [number, number];
export type LatLng = [number, number];

export type LineStringGeometry = {
  type: "LineString";
  coordinates: Coordinate[];
};

export type MultiLineStringGeometry = {
  type: "MultiLineString";
  coordinates: Coordinate[][];
};

export type SupportedGeometry = LineStringGeometry | MultiLineStringGeometry;

export type RoadMapItem = {
  region: string;
  lat: number;
  lon: number;
  status: RoadStatus;
  geometryType: SupportedGeometry["type"];
  pathLatLngs: LatLng[] | LatLng[][];
  idRoadLink: string | null;
  inspireId: string | null;
  nationalRoadCode: string | null;
  localRoadCode: string | null;
  name: string;
};

const OK_STATUS_THRESHOLD = 0.9;
const WARNING_STATUS_THRESHOLD = 0.98;

export function getColor(status: RoadStatus): string {
  if (status === "ok") {
    return "#32CD32";
  }
  if (status === "warning") {
    return "#f59e0b";
  }
  return "#dc2626";
}

export function getDotRadius(status: RoadStatus): number {
  if (status === "critical") {
    return 7;
  }
  if (status === "warning") {
    return 6;
  }
  return 4;
}

export function getZoomAdjustedDotRadius(status: RoadStatus, zoom: number): number {
  const baseRadius = getDotRadius(status);
  const clampedZoom = Math.min(12, Math.max(6, zoom));
  const minScale = 0.2;
  const normalizedZoom = (clampedZoom - 6) / 6;
  const zoomScale = minScale + (1 - minScale) * Math.pow(normalizedZoom, 1.35);
  const scaledRadius = Number((baseRadius * zoomScale).toFixed(1));
  return Math.max(1, scaledRadius);
}

export function shouldShowByFilter(item: RoadMapItem, filter: MapFilter): boolean {
  return filter === "all" || item.status === filter;
}

export function toLeafletLatLngs(
  geometry: SupportedGeometry,
): LatLng[] | LatLng[][] {
  if (geometry.type === "LineString") {
    return geometry.coordinates.map(([lon, lat]) => [lat, lon] as LatLng);
  }
  return geometry.coordinates.map((line) =>
    line.map(([lon, lat]) => [lat, lon] as LatLng),
  );
}

export function getLineMidpoint(
  geometry: { type: string; coordinates: unknown } | SupportedGeometry,
): { lat: number; lon: number } | null {
  if (geometry.type === "LineString") {
    const typedGeometry = geometry as LineStringGeometry;
    const line = lineString(typedGeometry.coordinates);
    const len = length(line, { units: "kilometers" });
    const midpoint = along(line, len / 2, { units: "kilometers" });
    const [lon, lat] = midpoint.geometry.coordinates;
    return { lat, lon };
  }

  if (geometry.type === "MultiLineString") {
    const typedGeometry = geometry as MultiLineStringGeometry;
    let longestLine: ReturnType<typeof lineString> | null = null;
    let longestLen = 0;

    for (const coords of typedGeometry.coordinates) {
      const currentLine = lineString(coords);
      const currentLen = length(currentLine, { units: "kilometers" });
      if (currentLen > longestLen) {
        longestLine = currentLine;
        longestLen = currentLen;
      }
    }

    if (!longestLine) {
      return null;
    }

    const midpoint = along(longestLine, longestLen / 2, { units: "kilometers" });
    const [lon, lat] = midpoint.geometry.coordinates;
    return { lat, lon };
  }

  return null;
}

export function normalizeStatus(
  inputStatus: unknown,
  randomValue: number = Math.random(),
): RoadStatus {
  if (inputStatus === "ok" || inputStatus === "warning" || inputStatus === "critical") {
    return inputStatus;
  }
  if (randomValue < OK_STATUS_THRESHOLD) {
    return "ok";
  }
  if (randomValue < WARNING_STATUS_THRESHOLD) {
    return "warning";
  }
  return "critical";
}

export function randomizeStatus(randomValue: number = Math.random()): RoadStatus {
  if (randomValue < OK_STATUS_THRESHOLD) {
    return "ok";
  }
  if (randomValue < WARNING_STATUS_THRESHOLD) {
    return "warning";
  }
  return "critical";
}

export function escapeHtml(value: unknown): string {
  let normalized = "";
  if (typeof value === "string") {
    normalized = value;
  } else if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    normalized = String(value);
  } else if (value && typeof value === "object") {
    const json = JSON.stringify(value);
    normalized = json ?? "";
  }

  return normalized
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
