import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
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

const REGION_FILES = [
  { id: "norte", path: "./assets/geojson/norte.geojson" },
  { id: "centro", path: "./assets/geojson/centro.geojson" },
  { id: "lisboa", path: "./assets/geojson/lisboa.geojson" },
  { id: "alentejo", path: "./assets/geojson/alentejo.geojson" },
  { id: "algarve", path: "./assets/geojson/algarve.geojson" },
] as const;

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

type GeoJsonFeatureCollection = {
  features?: GeoJsonRoadFeature[];
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

function popupHtml(item: RoadMapItem): string {
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

function createRoadName(props: GeoJsonRoadProperties): string {
  return (
    props.geographicalname ||
    props.nationalroadcode ||
    props.localroadcode ||
    props.id_roadlink ||
    "Estrada desconhecida"
  );
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

async function loadRegionRoads(region: { id: string; path: string }): Promise<RoadMapItem[]> {
  const response = await fetch(region.path);
  if (!response.ok) {
    throw new Error(`Falha ao carregar ${region.path}: ${response.status}`);
  }

  const data = (await response.json()) as GeoJsonFeatureCollection;
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

export const PortugalRoadMap = () => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const basePathLayerRef = useRef<L.LayerGroup | null>(null);
  const alertPathLayerRef = useRef<L.LayerGroup | null>(null);
  const dotLayerRef = useRef<L.LayerGroup | null>(null);
  const hasAutoFittedRef = useRef(false);

  const [roadItems, setRoadItems] = useState<RoadMapItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [currentFilter, setCurrentFilter] = useState<MapFilter>("all");
  const [mapZoom, setMapZoom] = useState(7);

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
    basePathLayerRef.current = L.layerGroup().addTo(map);
    alertPathLayerRef.current = L.layerGroup().addTo(map);
    dotLayerRef.current = L.layerGroup().addTo(map);
    map.whenReady(() => map.invalidateSize({ pan: false, animate: false }));

    return () => {
      map.remove();
      mapRef.current = null;
      basePathLayerRef.current = null;
      alertPathLayerRef.current = null;
      dotLayerRef.current = null;
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
    let isActive = true;
    async function loadAllRoads() {
      try {
        setIsLoading(true);
        setErrorMessage(null);
        const regions = await Promise.all(REGION_FILES.map((region) => loadRegionRoads(region)));
        if (!isActive) {
          return;
        }
        setRoadItems(regions.flat());
      } catch (error) {
        if (!isActive) {
          return;
        }
        if (error instanceof Error) {
          setErrorMessage(error.message);
        } else {
          setErrorMessage("Falha ao carregar os dados do mapa.");
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    void loadAllRoads();

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (!roadItems.length || hasAutoFittedRef.current) {
      return;
    }
    fitPortugal();
    hasAutoFittedRef.current = true;
  }, [fitPortugal, roadItems.length]);

  const visibleRoads = useMemo(
    () => roadItems.filter((item) => shouldShowByFilter(item, currentFilter)),
    [currentFilter, roadItems],
  );

  useEffect(() => {
    if (!basePathLayerRef.current || !alertPathLayerRef.current) {
      return;
    }

    basePathLayerRef.current.clearLayers();
    alertPathLayerRef.current.clearLayers();

    for (const item of visibleRoads) {
      const popup = popupHtml(item);
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
        L.polyline(linePath, baseStyle).bindPopup(popup).addTo(basePathLayerRef.current);
        L.polyline(linePath, alertStyle).bindPopup(popup).addTo(alertPathLayerRef.current);
      } else {
        const segments = item.pathLatLngs as L.LatLngExpression[][];
        for (const segment of segments) {
          L.polyline(segment, baseStyle).bindPopup(popup).addTo(basePathLayerRef.current);
          L.polyline(segment, alertStyle).bindPopup(popup).addTo(alertPathLayerRef.current);
        }
      }
    }
  }, [visibleRoads]);

  useEffect(() => {
    if (!dotLayerRef.current) {
      return;
    }

    dotLayerRef.current.clearLayers();

    for (const item of visibleRoads) {
      const popup = popupHtml(item);

      L.circleMarker([item.lat, item.lon], {
        radius: getZoomAdjustedDotRadius(item.status, mapZoom),
        color: getColor(item.status),
        weight: 1,
        fillColor: getColor(item.status),
        fillOpacity: 0.95,
      })
        .bindPopup(popup)
        .addTo(dotLayerRef.current);
    }
  }, [mapZoom, visibleRoads]);

  const visibleCount = visibleRoads.length;

  return (
    <div className="pt-map-page">
      <div ref={mapContainerRef} className="pt-map-canvas" />
      <div className="pt-map-panel">
        <h3 className="pt-map-title">Estradas de Portugal - Percursos e Pontos</h3>

        <div className="pt-map-section-title">Acoes</div>
        <div>
          <button
            className="pt-map-button"
            onClick={fitPortugal}
            disabled={isLoading || !!errorMessage}
          >
            Ajustar a Portugal
          </button>
          <button
            className="pt-map-button"
            onClick={() => setCurrentFilter("all")}
            disabled={isLoading || !!errorMessage}
          >
            Mostrar tudo
          </button>
          <button
            className="pt-map-button"
            onClick={() => setCurrentFilter("warning")}
            disabled={isLoading || !!errorMessage}
          >
            Apenas aviso
          </button>
          <button
            className="pt-map-button"
            onClick={() => setCurrentFilter("critical")}
            disabled={isLoading || !!errorMessage}
          >
            Apenas critico
          </button>
          <button
            className="pt-map-button"
            onClick={() =>
              setRoadItems((previousItems) =>
                previousItems.map((item) => ({
                  ...item,
                  status: randomizeStatus(),
                })),
              )
            }
            disabled={isLoading || !!errorMessage}
          >
            Aleatorizar
          </button>
        </div>

        <div className="pt-map-message">
          {isLoading && "A carregar dados das estradas..."}
          {!isLoading && errorMessage && `Erro no mapa: ${errorMessage}`}
          {!isLoading &&
            !errorMessage &&
            `A mostrar ${visibleCount} de ${roadItems.length} estradas`}
        </div>

        <div className="pt-map-legend">
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
        </div>
      </div>
    </div>
  );
};
