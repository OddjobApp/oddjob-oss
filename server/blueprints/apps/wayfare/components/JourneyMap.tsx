import React, { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import type { Journey, TripPlan } from "../lib/workflow";
export default function JourneyMap({
  journey,
  plan,
  token,
  selectedLeg,
  onSelectLeg,
}: {
  journey: Journey;
  plan: TripPlan;
  token: string;
  selectedLeg: number | null;
  onSelectLeg: (index: number) => void;
}) {
  const element = useRef<HTMLDivElement>(null),
    mapRef = useRef<mapboxgl.Map | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    if (!element.current) return;
    let map: mapboxgl.Map | undefined;
    setError("");
    try {
      map = new mapboxgl.Map({
        container: element.current,
        accessToken: token,
        style: "mapbox://styles/mapbox/dark-v11",
        center: [plan.originPoint!.longitude, plan.originPoint!.latitude],
        zoom: 5,
      });
      mapRef.current = map;
      map.addControl(new mapboxgl.NavigationControl(), "top-right");
      map.on("error", () =>
        setError(
          "Mapbox could not load the map. Check browser token URL restrictions, quotas, WebGL and connectivity. The leg table remains available.",
        ),
      );
      map.on("load", () => {
        const colors = ["#818cf8", "#34d399", "#fbbf24", "#fb7185", "#38bdf8"];
        journey.legs.forEach((leg, index) => {
          map!.addSource(`leg-${index}`, {
            type: "geojson",
            data: {
              type: "Feature",
              properties: {},
              geometry: { type: "LineString", coordinates: leg.coordinates },
            },
          });
          map!.addLayer({
            id: `leg-${index}`,
            type: "line",
            source: `leg-${index}`,
            paint: {
              "line-color": colors[index % colors.length],
              "line-width": selectedLeg === index ? 8 : 5,
              "line-opacity":
                selectedLeg === null || selectedLeg === index ? 1 : 0.3,
            },
            layout: { "line-join": "round", "line-cap": "round" },
          });
          map!.on("click", `leg-${index}`, () => onSelectLeg(index));
          map!.on("mouseenter", `leg-${index}`, () => {
            map!.getCanvas().style.cursor = "pointer";
          });
          map!.on("mouseleave", `leg-${index}`, () => {
            map!.getCanvas().style.cursor = "";
          });
        });
        const points = [
          { ...plan.originPoint!, name: plan.origin },
          ...plan.stops,
          { ...plan.destinationPoint!, name: plan.destination },
        ];
        points.forEach((point, index) => {
          const marker = document.createElement("button");
          marker.type = "button";
          marker.textContent = String(index + 1);
          marker.setAttribute("aria-label", `${index + 1}: ${point.name}`);
          Object.assign(marker.style, {
            background: "#4f46e5",
            color: "white",
            border: "2px solid white",
            borderRadius: "50%",
            width: "30px",
            height: "30px",
            fontWeight: "bold",
          });
          marker.addEventListener("click", () =>
            onSelectLeg(Math.min(index, journey.legs.length - 1)),
          );
          new mapboxgl.Marker({ element: marker })
            .setLngLat([point.longitude!, point.latitude!])
            .setPopup(
              new mapboxgl.Popup().setText(`${index + 1}. ${point.name}`),
            )
            .addTo(map!);
        });
        const bounds = new mapboxgl.LngLatBounds();
        journey.legs.forEach((l) =>
          l.coordinates.forEach((c) => bounds.extend([c[0], c[1]])),
        );
        map!.fitBounds(bounds, { padding: 45, maxZoom: 12, duration: 0 });
      });
      const observer = new ResizeObserver(() => map?.resize());
      observer.observe(element.current);
      return () => {
        observer.disconnect();
        mapRef.current = null;
        map?.remove();
      };
    } catch {
      setError(
        "Mapbox could not initialize. WebGL may be unavailable. Use the leg table below.",
      );
      return () => map?.remove();
    }
  }, [journey, token]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const highlight = () =>
      journey.legs.forEach((_, index) => {
        if (map.getLayer(`leg-${index}`)) {
          map.setPaintProperty(
            `leg-${index}`,
            "line-width",
            selectedLeg === index ? 8 : 5,
          );
          map.setPaintProperty(
            `leg-${index}`,
            "line-opacity",
            selectedLeg === null || selectedLeg === index ? 1 : 0.3,
          );
        }
      });
    if (map.isStyleLoaded()) highlight();
    else map.on("load", highlight);
    return () => {
      map.off("load", highlight);
    };
  }, [selectedLeg, journey]);
  return (
    <section aria-label="Mapbox journey map">
      <div
        ref={element}
        style={{ height: 420, width: "100%", borderRadius: 14 }}
      />
      {error && (
        <p role="alert" className="text-amber-300 text-sm mt-2">
          {error}
        </p>
      )}
      <p className="text-xs text-zinc-400 mt-2">
        Select a colored leg or numbered stop. The matching leg is highlighted
        in the table.
      </p>
    </section>
  );
}
