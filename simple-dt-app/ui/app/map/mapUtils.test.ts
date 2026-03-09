import { describe, expect, it } from "vitest";
import {
  escapeHtml,
  getColor,
  getDotRadius,
  getZoomAdjustedDotRadius,
  getLineMidpoint,
  shouldShowByFilter,
  toLeafletLatLngs,
  type MapFilter,
  type RoadMapItem,
} from "./mapUtils";

describe("mapUtils", () => {
  it("returns color by status", () => {
    expect(getColor("ok")).toBe("#32CD32");
    expect(getColor("warning")).toBe("#f59e0b");
    expect(getColor("critical")).toBe("#dc2626");
  });

  it("returns dot radius by status", () => {
    expect(getDotRadius("ok")).toBe(4);
    expect(getDotRadius("warning")).toBe(6);
    expect(getDotRadius("critical")).toBe(7);
  });

  it("reduces dot radius when zoomed out and keeps base size on close zoom", () => {
    expect(getZoomAdjustedDotRadius("warning", 6)).toBeLessThan(getDotRadius("warning"));
    expect(getZoomAdjustedDotRadius("warning", 6)).toBeLessThanOrEqual(2);
    expect(getZoomAdjustedDotRadius("critical", 12)).toBe(getDotRadius("critical"));
    expect(getZoomAdjustedDotRadius("ok", 20)).toBe(getDotRadius("ok"));
  });

  it("filters roads by map filter", () => {
    const baseItem = { status: "warning" } as RoadMapItem;
    expect(shouldShowByFilter(baseItem, "all")).toBe(true);
    expect(shouldShowByFilter(baseItem, "warning")).toBe(true);
    expect(shouldShowByFilter(baseItem, "critical")).toBe(false);
  });

  it("converts LineString and MultiLineString coordinates to Leaflet lat/lngs", () => {
    const lineString = {
      type: "LineString" as const,
      coordinates: [
        [-8.6, 41.1],
        [-8.5, 41.2],
      ],
    };

    const multiLineString = {
      type: "MultiLineString" as const,
      coordinates: [
        [
          [-8.6, 41.1],
          [-8.5, 41.2],
        ],
      ],
    };

    expect(toLeafletLatLngs(lineString)).toEqual([
      [41.1, -8.6],
      [41.2, -8.5],
    ]);

    expect(toLeafletLatLngs(multiLineString)).toEqual([
      [
        [41.1, -8.6],
        [41.2, -8.5],
      ],
    ]);
  });

  it("returns midpoint for LineString and null for unsupported geometry", () => {
    const point = getLineMidpoint({
      type: "LineString",
      coordinates: [
        [-8.6, 41.1],
        [-8.5, 41.2],
        [-8.4, 41.3],
      ],
    });

    expect(point).not.toBeNull();
    expect(point?.lat).toBeTypeOf("number");
    expect(point?.lon).toBeTypeOf("number");

    expect(getLineMidpoint({ type: "Point", coordinates: [-8.6, 41.1] })).toBe(
      null,
    );
  });

  it("accepts only supported filter values", () => {
    const filters: MapFilter[] = ["all", "warning", "critical"];
    expect(filters).toHaveLength(3);
  });

  it("escapes HTML for string and non-string values", () => {
    expect(escapeHtml("<road>&'\"")).toBe("&lt;road&gt;&amp;&#39;&quot;");
    expect(escapeHtml(12345)).toBe("12345");
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });
});
