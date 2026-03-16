import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import Colors from "@dynatrace/strato-design-tokens/colors";
import "./PortugalRoadMap.css";
import {
  escapeHtml,
  getColor,
  getZoomAdjustedDotRadius,
  getLineMidpoint,
  normalizeStatus,
  randomizeStatus,
  shouldShowByFilter,
  toLeafletLatLngs,
  type MapFilter,
  type RoadMapItem,
  type SupportedGeometry,
} from "../map/mapUtils";

const PORTUGAL_BOUNDS = L.latLngBounds([36.8, -9.6], [42.2, -6.0]);
const RAILWAY_LINE_COLOR = "#38bdf8";
const RAILWAY_STATION_COLOR = "#22d3ee";

const UI_ASSET_BASE_PATH = "/ui/assets/geojson";
const UI_DATA_BASE_PATH = "/ui/assets/data";

const REGION_FILES = [
  { id: "norte", path: `${UI_ASSET_BASE_PATH}/norte.geojson` },
  { id: "centro", path: `${UI_ASSET_BASE_PATH}/centro.geojson` },
  { id: "lisboa", path: `${UI_ASSET_BASE_PATH}/lisboa.geojson` },
  { id: "alentejo", path: `${UI_ASSET_BASE_PATH}/alentejo.geojson` },
  { id: "algarve", path: `${UI_ASSET_BASE_PATH}/algarve.geojson` },
] as const;

const RAILWAY_BASE_MAP_PATH = `${UI_ASSET_BASE_PATH}/stations/base-map/Rede_Ferroviaria.geojson`;
const STATION_PINPOINTS_PATH =
  `${UI_ASSET_BASE_PATH}/stations/stations-pinpoint/estacoes.geojson`;
const STATION_REQUEST_METRICS_PATH =
  `${UI_DATA_BASE_PATH}/acessos-estacoes-table-data.csv`;
const STATION_REQUEST_MIN_COLOR = "#00c2ff";
const STATION_REQUEST_MID_COLOR = "#39ff14";
const STATION_REQUEST_MAX_COLOR = "#ff3131";
const STATION_REQUEST_LEGEND_GRADIENT = `linear-gradient(90deg, ${STATION_REQUEST_MIN_COLOR} 0%, ${STATION_REQUEST_MID_COLOR} 50%, ${STATION_REQUEST_MAX_COLOR} 100%)`;
const STATION_REQUEST_LABEL_FORMATTER = new Intl.NumberFormat("pt-PT", {
  maximumFractionDigits: 1,
});
const STATION_REQUEST_COMPACT_FORMATTER = new Intl.NumberFormat("pt-PT", {
  notation: "compact",
  maximumFractionDigits: 1,
});

type LayerMode = "roads" | "stations" | "both";
type LayerLoadState = "idle" | "loading" | "loaded" | "error";

type GeoJsonRoadProperties = {
  status?: unknown;
  id_roadlink?: string;
  inspireid?: string;
  nationalroadcode?: string;
  localroadcode?: string;
  geographicalname?: string;
};

type GeoJsonRoadFeature = {
  geometry?: SupportedGeometry | { type: string; coordinates: unknown };
  properties?: GeoJsonRoadProperties;
};

type GeoJsonRoadFeatureCollection = {
  features?: GeoJsonRoadFeature[];
};

type GeoJsonRailwayProperties = {
  designacao?: unknown;
  exploracao?: unknown;
  segmento?: unknown;
};

type GeoJsonRailwayFeature = {
  geometry?: SupportedGeometry | { type: string; coordinates: unknown };
  properties?: GeoJsonRailwayProperties;
};

type GeoJsonRailwayFeatureCollection = {
  features?: GeoJsonRailwayFeature[];
};

type RailwaySegmentItem = {
  geometryType: SupportedGeometry["type"];
  name: string;
  operation: string | null;
  segment: string | null;
  pathLatLngs: L.LatLngExpression[] | L.LatLngExpression[][];
};

type StationAttributes = {
  desig_tipo?: unknown;
  desiggrupo?: unknown;
  designacao?: unknown;
  codlinhaiet50?: unknown;
  codsegmentoiet50?: unknown;
  coddepende?: unknown;
};

type StationPointFeature = {
  attributes?: StationAttributes;
  geometry?: {
    x?: unknown;
    y?: unknown;
  };
};

type StationPointCollection = {
  features?: StationPointFeature[];
};

type StationMapItem = {
  lat: number;
  lon: number;
  name: string;
  type: string | null;
  group: string | null;
  lineCode: number | null;
  segmentCode: number | null;
  dependencyCode: number | null;
  requestCount: number;
};

function statusLabel(status: RoadMapItem["status"]): string {
  if (status === "warning") {
    return "aviso";
  }
  if (status === "critical") {
    return "critico";
  }
  return "ok";
}

function getLayerModeLabel(layerMode: LayerMode): string {
  if (layerMode === "roads") {
    return "Estradas";
  }
  if (layerMode === "stations") {
    return "Estacoes";
  }
  return "Ambas";
}

function roadPopupHtml(item: RoadMapItem): string {
  const name = escapeHtml(item.name);
  const region = escapeHtml(item.region);
  const status = escapeHtml(statusLabel(item.status));
  const idRoadLink = escapeHtml(item.idRoadLink ?? "n/d");
  const inspireId = escapeHtml(item.inspireId ?? "n/d");
  const nationalRoadCode = escapeHtml(item.nationalRoadCode ?? "n/d");
  const localRoadCode = escapeHtml(item.localRoadCode ?? "n/d");

  return `
    <div style="min-width:220px;">
      <div style="font-weight:bold;margin-bottom:8px;">${name}</div>
      <div><strong>Estado:</strong> ${status}</div>
      <div><strong>Regiao:</strong> ${region}</div>
      <div><strong>Ligacao viaria:</strong> ${idRoadLink}</div>
      <div><strong>Inspire ID:</strong> ${inspireId}</div>
      <div><strong>Codigo nacional:</strong> ${nationalRoadCode}</div>
      <div><strong>Codigo local:</strong> ${localRoadCode}</div>
    </div>
  `;
}

function railwaySegmentPopupHtml(item: RailwaySegmentItem): string {
  const name = escapeHtml(item.name);
  const operation = escapeHtml(item.operation ?? "n/d");
  const segment = escapeHtml(item.segment ?? "n/d");

  return `
    <div style="min-width:220px;">
      <div style="font-weight:bold;margin-bottom:8px;">${name}</div>
      <div><strong>Exploracao:</strong> ${operation}</div>
      <div><strong>Segmento:</strong> ${segment}</div>
    </div>
  `;
}

function stationPopupHtml(item: StationMapItem): string {
  const name = escapeHtml(item.name);
  const type = escapeHtml(item.type ?? "n/d");
  const group = escapeHtml(item.group ?? "n/d");
  const lineCode = escapeHtml(item.lineCode ?? "n/d");
  const segmentCode = escapeHtml(item.segmentCode ?? "n/d");
  const dependencyCode = escapeHtml(item.dependencyCode ?? "n/d");
  const requestCount = escapeHtml(formatStationRequestCount(item.requestCount));

  return `
    <div style="min-width:220px;">
      <div style="font-weight:bold;margin-bottom:8px;">${name}</div>
      <div><strong>Tipo:</strong> ${type}</div>
      <div><strong>Grupo:</strong> ${group}</div>
      <div><strong>Linha IET50:</strong> ${lineCode}</div>
      <div><strong>Segmento IET50:</strong> ${segmentCode}</div>
      <div><strong>Dependencia:</strong> ${dependencyCode}</div>
      <div><strong>Request count:</strong> ${requestCount}</div>
    </div>
  `;
}

function createRoadName(props: GeoJsonRoadProperties): string {
  return (
    props.geographicalname ||
    props.nationalroadcode ||
    props.localroadcode ||
    props.id_roadlink ||
    "Estrada desconhecida"
  );
}

function createRailwayName(props: GeoJsonRailwayProperties): string {
  if (typeof props.designacao === "string" && props.designacao.trim()) {
    return props.designacao;
  }
  if (typeof props.segmento === "string" && props.segmento.trim()) {
    return props.segmento;
  }
  return "Troco ferroviario";
}

function isSupportedGeometry(geometry: unknown): geometry is SupportedGeometry {
  if (!geometry || typeof geometry !== "object") {
    return false;
  }

  const typedGeometry = geometry as { type?: unknown };
  return (
    typedGeometry.type === "LineString" || typedGeometry.type === "MultiLineString"
  );
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

function normalizeInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function normalizeDecimal(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const normalized = value.trim().replace(",", ".");
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function isFiniteCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

async function fetchText(path: string): Promise<string> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Falha ao carregar ${path}: ${response.status}`);
  }

  return response.text();
}

async function fetchJson<T>(path: string): Promise<T> {
  const responseText = await fetchText(path);
  try {
    return JSON.parse(responseText) as T;
  } catch {
    if (responseText.trimStart().startsWith("<")) {
      throw new Error(`O caminho ${path} devolveu HTML em vez de JSON.`);
    }

    throw new Error(`Falha ao interpretar o JSON de ${path}.`);
  }
}

function parseCsvRow(line: string): string[] {
  const fields: string[] = [];
  let currentField = "";
  let isInsideQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const currentChar = line[index];

    if (currentChar === "\"") {
      const nextChar = line[index + 1];
      if (isInsideQuotes && nextChar === "\"") {
        currentField += "\"";
        index += 1;
      } else {
        isInsideQuotes = !isInsideQuotes;
      }
      continue;
    }

    if (currentChar === "," && !isInsideQuotes) {
      fields.push(currentField);
      currentField = "";
      continue;
    }

    currentField += currentChar;
  }

  fields.push(currentField);
  return fields;
}

function formatStationRequestCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0";
  }

  return STATION_REQUEST_LABEL_FORMATTER.format(value);
}

function formatStationRequestLabel(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0";
  }

  return STATION_REQUEST_COMPACT_FORMATTER.format(value);
}

function parseHexColor(color: string): [number, number, number] {
  const normalizedColor = color.replace("#", "");
  const safeColor =
    normalizedColor.length === 3
      ? normalizedColor
          .split("")
          .map((char) => `${char}${char}`)
          .join("")
      : normalizedColor;

  return [
    Number.parseInt(safeColor.slice(0, 2), 16),
    Number.parseInt(safeColor.slice(2, 4), 16),
    Number.parseInt(safeColor.slice(4, 6), 16),
  ];
}

function mixChannel(start: number, end: number, ratio: number): number {
  return Math.round(start + (end - start) * ratio);
}

function mixHexColors(startColor: string, endColor: string, ratio: number): string {
  const [startRed, startGreen, startBlue] = parseHexColor(startColor);
  const [endRed, endGreen, endBlue] = parseHexColor(endColor);

  const mixedColor = [startRed, startGreen, startBlue]
    .map((channel, index) =>
      mixChannel(channel, [endRed, endGreen, endBlue][index], ratio)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");

  return `#${mixedColor}`;
}

function getRelativeLuminance(color: string): number {
  const [red, green, blue] = parseHexColor(color).map((channel) => {
    const normalizedChannel = channel / 255;
    return normalizedChannel <= 0.03928
      ? normalizedChannel / 12.92
      : Math.pow((normalizedChannel + 0.055) / 1.055, 2.4);
  });

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function getStationRequestColor(requestCount: number, maxRequestCount: number): string {
  if (maxRequestCount <= 0 || requestCount <= 0) {
    return STATION_REQUEST_MIN_COLOR;
  }

  const normalizedValue = Math.log1p(requestCount) / Math.log1p(maxRequestCount);
  if (normalizedValue <= 0.5) {
    return mixHexColors(
      STATION_REQUEST_MIN_COLOR,
      STATION_REQUEST_MID_COLOR,
      normalizedValue / 0.5,
    );
  }

  return mixHexColors(
    STATION_REQUEST_MID_COLOR,
    STATION_REQUEST_MAX_COLOR,
    (normalizedValue - 0.5) / 0.5,
  );
}

function getStationMarkerSize(zoom: number, hasRequests: boolean): number {
  const clampedZoom = Math.min(12, Math.max(6, zoom));
  const normalizedZoom = (clampedZoom - 6) / 6;
  const minSize = hasRequests ? 5 : 4;
  const maxSize = hasRequests ? 24 : 10;
  const scaledSize = minSize + (maxSize - minSize) * Math.pow(normalizedZoom, 1.22);

  return Math.round(scaledSize);
}

function createStationMarkerIcon(
  item: StationMapItem,
  maxRequestCount: number,
  zoom: number,
): L.DivIcon {
  const hasRequests = item.requestCount > 0;
  const fillColor = getStationRequestColor(item.requestCount, maxRequestCount);
  const requestLabel = escapeHtml(formatStationRequestLabel(item.requestCount));
  const markerSize = getStationMarkerSize(zoom, hasRequests);
  const fontSize = Math.max(0, Math.round(markerSize * (hasRequests ? 0.38 : 0.24)));
  const shouldShowLabel = hasRequests && zoom >= 9 && markerSize >= 16;
  const borderColor = hasRequests
    ? "rgba(255, 255, 255, 0.96)"
    : "rgba(148, 163, 184, 0.72)";
  const useDarkText = getRelativeLuminance(fillColor) > 0.46;
  const textColor = useDarkText ? "#04111f" : "#f8fafc";
  const textShadow = useDarkText
    ? "0 1px 2px rgba(248, 250, 252, 0.35)"
    : "0 1px 3px rgba(15, 23, 42, 0.65)";

  return L.divIcon({
    className: "pt-station-metric-icon-wrapper",
    html: `
      <span
        class="pt-station-metric-icon${hasRequests ? " is-active" : " is-empty"}"
        style="
          --pt-station-dot-fill:${escapeHtml(fillColor)};
          --pt-station-dot-size:${markerSize}px;
          --pt-station-dot-font-size:${fontSize}px;
          --pt-station-dot-border:${borderColor};
          --pt-station-dot-text:${textColor};
          --pt-station-dot-text-shadow:${textShadow};
        "
      >
        ${shouldShowLabel ? requestLabel : ""}
      </span>
    `,
    iconSize: [markerSize, markerSize],
    iconAnchor: [markerSize / 2, markerSize / 2],
    popupAnchor: [0, -Math.round(markerSize / 2)],
  });
}

async function loadRegionRoads(region: { id: string; path: string }): Promise<RoadMapItem[]> {
  const data = await fetchJson<GeoJsonRoadFeatureCollection>(region.path);
  if (!data || !Array.isArray(data.features)) {
    throw new Error(`${region.path} nao e um FeatureCollection GeoJSON valido`);
  }

  const mappedItems: RoadMapItem[] = [];
  for (const feature of data.features) {
    if (!isSupportedGeometry(feature.geometry)) {
      continue;
    }

    const midpoint = getLineMidpoint(feature.geometry);
    if (!midpoint) {
      continue;
    }

    const pathLatLngs = toLeafletLatLngs(feature.geometry);
    const props = feature.properties ?? {};

    mappedItems.push({
      region: region.id,
      lat: midpoint.lat,
      lon: midpoint.lon,
      status: normalizeStatus(props.status),
      geometryType: feature.geometry.type,
      pathLatLngs,
      idRoadLink: props.id_roadlink ?? null,
      inspireId: props.inspireid ?? null,
      nationalRoadCode: props.nationalroadcode ?? null,
      localRoadCode: props.localroadcode ?? null,
      name: createRoadName(props),
    });
  }

  return mappedItems;
}

async function loadRailwaySegments(): Promise<RailwaySegmentItem[]> {
  const data = await fetchJson<GeoJsonRailwayFeatureCollection>(RAILWAY_BASE_MAP_PATH);
  if (!data || !Array.isArray(data.features)) {
    throw new Error(`${RAILWAY_BASE_MAP_PATH} nao e um FeatureCollection GeoJSON valido`);
  }

  const mappedItems: RailwaySegmentItem[] = [];
  for (const feature of data.features) {
    if (!isSupportedGeometry(feature.geometry)) {
      continue;
    }

    const props = feature.properties ?? {};
    mappedItems.push({
      geometryType: feature.geometry.type,
      name: createRailwayName(props),
      operation: normalizeText(props.exploracao),
      segment: normalizeText(props.segmento),
      pathLatLngs: toLeafletLatLngs(feature.geometry),
    });
  }

  return mappedItems;
}

async function loadStationRequestMetrics(): Promise<Map<number, number>> {
  const csvText = await fetchText(STATION_REQUEST_METRICS_PATH);
  if (csvText.trimStart().startsWith("<")) {
    throw new Error(
      `${STATION_REQUEST_METRICS_PATH} devolveu HTML em vez do CSV de metricas.`,
    );
  }

  const rows = csvText
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean);

  if (rows.length === 0) {
    return new Map();
  }

  const headers = parseCsvRow(rows[0]).map((header) =>
    header.replace(/^\uFEFF/, "").trim().toLowerCase(),
  );
  const dependencyCodeIndex = headers.indexOf("coddepende");
  const requestCountIndex = headers.indexOf("request_count");

  if (dependencyCodeIndex === -1 || requestCountIndex === -1) {
    throw new Error(
      `${STATION_REQUEST_METRICS_PATH} nao contem as colunas coddepende e request_count.`,
    );
  }

  const metricsByDependencyCode = new Map<number, number>();
  for (const row of rows.slice(1)) {
    const columns = parseCsvRow(row);
    const dependencyCode = normalizeInteger(columns[dependencyCodeIndex]);
    const requestCount = normalizeDecimal(columns[requestCountIndex]);
    if (dependencyCode === null || requestCount === null) {
      continue;
    }

    metricsByDependencyCode.set(
      dependencyCode,
      (metricsByDependencyCode.get(dependencyCode) ?? 0) + requestCount,
    );
  }

  return metricsByDependencyCode;
}

async function loadStationPoints(): Promise<StationMapItem[]> {
  const data = await fetchJson<StationPointCollection>(STATION_PINPOINTS_PATH);
  if (!data || !Array.isArray(data.features)) {
    throw new Error(`${STATION_PINPOINTS_PATH} nao contem um conjunto de estacoes valido`);
  }

  const mappedItems: StationMapItem[] = [];
  for (const feature of data.features) {
    const lon = feature.geometry?.x;
    const lat = feature.geometry?.y;
    if (!isFiniteCoordinate(lat) || !isFiniteCoordinate(lon)) {
      continue;
    }

    const attributes = feature.attributes ?? {};
    mappedItems.push({
      lat,
      lon,
      name: normalizeText(attributes.designacao) ?? "Estacao sem nome",
      type: normalizeText(attributes.desig_tipo),
      group: normalizeText(attributes.desiggrupo),
      lineCode: normalizeInteger(attributes.codlinhaiet50),
      segmentCode: normalizeInteger(attributes.codsegmentoiet50),
      dependencyCode: normalizeInteger(attributes.coddepende),
      requestCount: 0,
    });
  }

  return mappedItems;
}

export const PortugalRoadMap = () => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const roadBasePathLayerRef = useRef<L.LayerGroup | null>(null);
  const roadAlertPathLayerRef = useRef<L.LayerGroup | null>(null);
  const roadDotLayerRef = useRef<L.LayerGroup | null>(null);
  const railwayPathLayerRef = useRef<L.LayerGroup | null>(null);
  const stationDotLayerRef = useRef<L.LayerGroup | null>(null);
  const hasAutoFittedRef = useRef(false);

  const [roadItems, setRoadItems] = useState<RoadMapItem[] | null>(null);
  const [roadLoadState, setRoadLoadState] = useState<LayerLoadState>("idle");
  const [roadLoadError, setRoadLoadError] = useState<string | null>(null);
  const [railwaySegments, setRailwaySegments] = useState<RailwaySegmentItem[] | null>(null);
  const [stationPoints, setStationPoints] = useState<StationMapItem[] | null>(null);
  const [stationLoadState, setStationLoadState] = useState<LayerLoadState>("idle");
  const [stationLoadError, setStationLoadError] = useState<string | null>(null);
  const [roadReloadKey, setRoadReloadKey] = useState(0);
  const [stationReloadKey, setStationReloadKey] = useState(0);
  const [currentFilter, setCurrentFilter] = useState<MapFilter>("all");
  const [mapZoom, setMapZoom] = useState(7);
  const [layerMode, setLayerMode] = useState<LayerMode>("roads");
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false);

  const showRoads = layerMode === "roads" || layerMode === "both";
  const showStations = layerMode === "stations" || layerMode === "both";

  const fitPortugal = useCallback(() => {
    mapRef.current?.fitBounds(PORTUGAL_BOUNDS, { padding: [20, 20] });
  }, []);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) {
      return;
    }

    const map = L.map(mapContainerRef.current, {
      zoomControl: true,
      preferCanvas: true,
      minZoom: 6,
    }).setView([39.5, -8.0], 7);

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png", {
      attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
      subdomains: "abcd",
      keepBuffer: 6,
    }).addTo(map);

    mapRef.current = map;
    setMapZoom(map.getZoom());
    roadBasePathLayerRef.current = L.layerGroup().addTo(map);
    roadAlertPathLayerRef.current = L.layerGroup().addTo(map);
    roadDotLayerRef.current = L.layerGroup().addTo(map);
    railwayPathLayerRef.current = L.layerGroup().addTo(map);
    stationDotLayerRef.current = L.layerGroup().addTo(map);
    map.whenReady(() => map.invalidateSize({ pan: false, animate: false }));

    return () => {
      map.remove();
      mapRef.current = null;
      roadBasePathLayerRef.current = null;
      roadAlertPathLayerRef.current = null;
      roadDotLayerRef.current = null;
      railwayPathLayerRef.current = null;
      stationDotLayerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const mapContainer = mapContainerRef.current;
    if (!map || !mapContainer || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      map.invalidateSize({ pan: false, animate: false });
    });
    observer.observe(mapContainer);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const onZoomEnd = () => {
      setMapZoom(map.getZoom());
    };

    map.on("zoomend", onZoomEnd);
    return () => {
      map.off("zoomend", onZoomEnd);
    };
  }, []);

  useEffect(() => {
    if (!showRoads || roadItems) {
      return;
    }

    let isActive = true;

    async function loadAllRoads() {
      try {
        setRoadLoadState("loading");
        setRoadLoadError(null);
        const regions = await Promise.all(REGION_FILES.map((region) => loadRegionRoads(region)));
        if (!isActive) {
          return;
        }

        setRoadItems(regions.flat());
        setRoadLoadState("loaded");
      } catch (error) {
        if (!isActive) {
          return;
        }

        setRoadLoadState("error");
        if (error instanceof Error) {
          setRoadLoadError(error.message);
        } else {
          setRoadLoadError("Falha ao carregar os dados das estradas.");
        }
      }
    }

    void loadAllRoads();

    return () => {
      isActive = false;
    };
  }, [roadItems, roadReloadKey, showRoads]);

  useEffect(() => {
    if (!showStations || (railwaySegments && stationPoints)) {
      return;
    }

    let isActive = true;

    async function loadAllStationsData() {
      try {
        setStationLoadState("loading");
        setStationLoadError(null);
        const [loadedRailwaySegments, loadedStationPoints, stationRequestMetrics] =
          await Promise.all([
          loadRailwaySegments(),
          loadStationPoints(),
          loadStationRequestMetrics(),
        ]);
        if (!isActive) {
          return;
        }

        setRailwaySegments(loadedRailwaySegments);
        setStationPoints(
          loadedStationPoints.map((item) => ({
            ...item,
            requestCount:
              item.dependencyCode !== null
                ? stationRequestMetrics.get(item.dependencyCode) ?? 0
                : 0,
          })),
        );
        setStationLoadState("loaded");
      } catch (error) {
        if (!isActive) {
          return;
        }

        setStationLoadState("error");
        if (error instanceof Error) {
          setStationLoadError(error.message);
        } else {
          setStationLoadError("Falha ao carregar os dados das estacoes.");
        }
      }
    }

    void loadAllStationsData();

    return () => {
      isActive = false;
    };
  }, [railwaySegments, showStations, stationPoints, stationReloadKey]);

  const visibleRoads = useMemo(
    () =>
      showRoads && roadItems
        ? roadItems.filter((item) => shouldShowByFilter(item, currentFilter))
        : [],
    [currentFilter, roadItems, showRoads],
  );

  const visibleRailwaySegments = useMemo(
    () => (showStations && railwaySegments ? railwaySegments : []),
    [railwaySegments, showStations],
  );

  const visibleStationPoints = useMemo(
    () => (showStations && stationPoints ? stationPoints : []),
    [showStations, stationPoints],
  );
  const maxStationRequestCount = useMemo(
    () =>
      stationPoints?.reduce(
        (highestCount, item) => Math.max(highestCount, item.requestCount),
        0,
      ) ?? 0,
    [stationPoints],
  );

  const hasVisibleData =
    visibleRoads.length > 0 ||
    visibleRailwaySegments.length > 0 ||
    visibleStationPoints.length > 0;

  useEffect(() => {
    if (!hasVisibleData || hasAutoFittedRef.current) {
      return;
    }

    fitPortugal();
    hasAutoFittedRef.current = true;
  }, [fitPortugal, hasVisibleData]);

  useEffect(() => {
    if (
      !roadBasePathLayerRef.current ||
      !roadAlertPathLayerRef.current ||
      !roadDotLayerRef.current
    ) {
      return;
    }

    roadBasePathLayerRef.current.clearLayers();
    roadAlertPathLayerRef.current.clearLayers();
    roadDotLayerRef.current.clearLayers();

    if (!showRoads) {
      return;
    }

    for (const item of visibleRoads) {
      const popup = roadPopupHtml(item);
      const baseStyle: L.PathOptions = {
        color: "#6b7280",
        weight: 2,
        opacity: 0.35,
      };
      const alertStyle: L.PathOptions = {
        color: getColor(item.status),
        weight: item.status === "critical" ? 4 : 3,
        opacity: 0.95,
      };

      if (item.geometryType === "LineString") {
        const linePath = item.pathLatLngs as L.LatLngExpression[];
        L.polyline(linePath, baseStyle).bindPopup(popup).addTo(roadBasePathLayerRef.current);
        L.polyline(linePath, alertStyle)
          .bindPopup(popup)
          .addTo(roadAlertPathLayerRef.current);
      } else {
        const segments = item.pathLatLngs as L.LatLngExpression[][];
        for (const segment of segments) {
          L.polyline(segment, baseStyle)
            .bindPopup(popup)
            .addTo(roadBasePathLayerRef.current);
          L.polyline(segment, alertStyle)
            .bindPopup(popup)
            .addTo(roadAlertPathLayerRef.current);
        }
      }

      L.circleMarker([item.lat, item.lon], {
        radius: getZoomAdjustedDotRadius(item.status, mapZoom),
        color: getColor(item.status),
        weight: 1,
        fillColor: getColor(item.status),
        fillOpacity: 0.95,
      })
        .bindPopup(popup)
        .addTo(roadDotLayerRef.current);
    }
  }, [mapZoom, showRoads, visibleRoads]);

  useEffect(() => {
    if (!railwayPathLayerRef.current || !stationDotLayerRef.current) {
      return;
    }

    railwayPathLayerRef.current.clearLayers();
    stationDotLayerRef.current.clearLayers();

    if (!showStations) {
      return;
    }

    for (const item of visibleRailwaySegments) {
      const popup = railwaySegmentPopupHtml(item);
      const lineStyle: L.PathOptions = {
        color: RAILWAY_LINE_COLOR,
        weight: 2.4,
        opacity: 0.82,
      };

      if (item.geometryType === "LineString") {
        const linePath = item.pathLatLngs as L.LatLngExpression[];
        L.polyline(linePath, lineStyle)
          .bindPopup(popup)
          .addTo(railwayPathLayerRef.current);
      } else {
        const segments = item.pathLatLngs as L.LatLngExpression[][];
        for (const segment of segments) {
          L.polyline(segment, lineStyle)
            .bindPopup(popup)
            .addTo(railwayPathLayerRef.current);
        }
      }
    }

    for (const item of visibleStationPoints) {
      L.marker([item.lat, item.lon], {
        icon: createStationMarkerIcon(item, maxStationRequestCount, mapZoom),
      })
        .bindPopup(stationPopupHtml(item))
        .addTo(stationDotLayerRef.current);
    }
  }, [mapZoom, maxStationRequestCount, showStations, visibleRailwaySegments, visibleStationPoints]);

  const visibleRoadCount = visibleRoads.length;
  const totalRoadCount = roadItems?.length ?? 0;
  const totalRailwaySegmentCount = railwaySegments?.length ?? 0;
  const totalStationPointCount = stationPoints?.length ?? 0;

  const isLoadingSelectedLayers =
    (showRoads && roadLoadState === "loading") ||
    (showStations && stationLoadState === "loading");

  const activeErrors = [
    showRoads ? roadLoadError : null,
    showStations ? stationLoadError : null,
  ].filter((message): message is string => Boolean(message));

  const summaryMessage = [
    showRoads
      ? `Estradas: ${visibleRoadCount}/${totalRoadCount}`
      : null,
    showStations
      ? `Linhas ferroviarias: ${totalRailwaySegmentCount}`
      : null,
    showStations
      ? `Estacoes: ${totalStationPointCount}`
      : null,
  ]
    .filter((message): message is string => Boolean(message))
    .join(" | ");

  const activeStatusMessage = isLoadingSelectedLayers
    ? `A carregar ${getLayerModeLabel(layerMode).toLowerCase()}...`
    : activeErrors.length > 0
      ? `Erro no mapa: ${activeErrors.join(" | ")}`
      : summaryMessage || "Seleciona uma camada para visualizar os dados.";

  const roadsFilterDisabled =
    !showRoads || roadLoadState !== "loaded" || totalRoadCount === 0 || !!roadLoadError;

  const randomizeDisabled =
    roadsFilterDisabled || activeErrors.length > 0 || isLoadingSelectedLayers;

  const retryActiveLayers = () => {
    if (showRoads) {
      setRoadItems(null);
      setRoadLoadError(null);
      setRoadLoadState("idle");
      setRoadReloadKey((previous) => previous + 1);
    }

    if (showStations) {
      setRailwaySegments(null);
      setStationPoints(null);
      setStationLoadError(null);
      setStationLoadState("idle");
      setStationReloadKey((previous) => previous + 1);
    }
  };

  return (
    <div className="pt-map-page">
      <div ref={mapContainerRef} className="pt-map-canvas" />

      <div className={`pt-map-panel${isPanelCollapsed ? " is-collapsed" : ""}`}>
        <div className="pt-map-panel-header">
          {!isPanelCollapsed && (
            <div>
              <h3 className="pt-map-title">Mapa de Infraestruturas</h3>
              <div className="pt-map-subtitle">
                Alterna entre estradas, estacoes ou ambas sem carregar camadas
                desnecessarias.
              </div>
            </div>
          )}

          <button
            className="pt-map-button pt-map-button-ghost"
            type="button"
            onClick={() => setIsPanelCollapsed((previous) => !previous)}
            aria-expanded={!isPanelCollapsed}
          >
            {isPanelCollapsed ? "Abrir menu" : "Minimizar"}
          </button>
        </div>

        {!isPanelCollapsed && (
          <>
            <div className="pt-map-section-title">Camadas</div>
            <div className="pt-map-toggle-group" role="group" aria-label="Selecionar camadas">
              <button
                className={`pt-map-toggle-button${layerMode === "roads" ? " is-active" : ""}`}
                type="button"
                onClick={() => setLayerMode("roads")}
              >
                Estradas
              </button>
              <button
                className={`pt-map-toggle-button${layerMode === "stations" ? " is-active" : ""}`}
                type="button"
                onClick={() => setLayerMode("stations")}
              >
                Estacoes
              </button>
              <button
                className={`pt-map-toggle-button${layerMode === "both" ? " is-active" : ""}`}
                type="button"
                onClick={() => setLayerMode("both")}
              >
                Ambas
              </button>
            </div>

            <div className="pt-map-section-title">Acoes</div>
            <div className="pt-map-button-grid">
              <button className="pt-map-button" type="button" onClick={fitPortugal}>
                Ajustar a Portugal
              </button>
              <button
                className="pt-map-button"
                type="button"
                onClick={retryActiveLayers}
                disabled={isLoadingSelectedLayers}
              >
                Recarregar camada
              </button>
              <button
                className="pt-map-button"
                type="button"
                onClick={() =>
                  setRoadItems((previousItems) =>
                    previousItems?.map((item) => ({
                      ...item,
                      status: randomizeStatus(),
                    })) ?? null,
                  )
                }
                disabled={randomizeDisabled}
              >
                Aleatorizar estradas
              </button>
            </div>

            <div className="pt-map-section-title">Filtro de estradas</div>
            <div className="pt-map-button-grid">
              <button
                className={`pt-map-button${currentFilter === "all" ? " is-selected" : ""}`}
                type="button"
                onClick={() => setCurrentFilter("all")}
                disabled={roadsFilterDisabled}
              >
                Mostrar tudo
              </button>
              <button
                className={`pt-map-button${currentFilter === "warning" ? " is-selected" : ""}`}
                type="button"
                onClick={() => setCurrentFilter("warning")}
                disabled={roadsFilterDisabled}
              >
                Apenas aviso
              </button>
              <button
                className={`pt-map-button${currentFilter === "critical" ? " is-selected" : ""}`}
                type="button"
                onClick={() => setCurrentFilter("critical")}
                disabled={roadsFilterDisabled}
              >
                Apenas critico
              </button>
            </div>

            <div className="pt-map-message">{activeStatusMessage}</div>

            <div className="pt-map-legend">
              {showRoads && (
                <>
                  <div className="pt-map-section-title pt-map-section-title-inline">
                    Estradas
                  </div>
                  <div className="pt-map-legend-row">
                    <span className="pt-map-legend-line" style={{ background: "#6b7280" }} />
                    <span>Percursos base</span>
                  </div>
                  <div className="pt-map-legend-row">
                    <span className="pt-map-legend-line" style={{ background: "#f59e0b" }} />
                    <span>Percurso de aviso</span>
                  </div>
                  <div className="pt-map-legend-row">
                    <span className="pt-map-legend-line" style={{ background: "#dc2626" }} />
                    <span>Percurso critico</span>
                  </div>
                  <div className="pt-map-legend-row">
                    <span className="pt-map-legend-dot" style={{ background: "#f59e0b" }} />
                    <span>Ponto de aviso</span>
                  </div>
                  <div className="pt-map-legend-row">
                    <span className="pt-map-legend-dot" style={{ background: "#dc2626" }} />
                    <span>Ponto critico</span>
                  </div>
                </>
              )}

              {showStations && (
                <>
                  <div className="pt-map-section-title pt-map-section-title-inline">
                    Estações
                  </div>
                  <div className="pt-map-legend-row">
                    <span
                      className="pt-map-legend-line"
                      style={{ background: RAILWAY_LINE_COLOR }}
                    />
                    <span>Linha ferroviaria</span>
                  </div>
                  <div className="pt-map-legend-row">
                    <span
                      className="pt-map-legend-gradient"
                      style={{ background: STATION_REQUEST_LEGEND_GRADIENT }}
                    />
                    <span>
                      Request count no dot: azul em <strong>0</strong>, verde no meio e vermelho em{" "}
                      <strong>{formatStationRequestCount(maxStationRequestCount)}</strong>
                    </span>
                  </div>
                  <div className="pt-map-legend-row">
                    <span
                      className="pt-map-legend-dot"
                      style={{ background: "#93c5fd" }}
                    />
                    <span>Estacoes com requests acima de 0 ficam destacadas</span>
                  </div>
                  <div className="pt-map-legend-row">
                    <span
                      className="pt-map-legend-dot"
                      style={{ background: STATION_REQUEST_MIN_COLOR }}
                    />
                    <span>Estacao sem requests mapeados</span>
                  </div>
                  <div className="pt-map-legend-row">
                    <span
                      className="pt-map-legend-dot"
                      style={{ background: RAILWAY_STATION_COLOR }}
                    />
                    <span>Pin-point da estacao</span>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
