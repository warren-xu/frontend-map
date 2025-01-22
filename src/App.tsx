import React, { useEffect, useState, useRef } from 'react';

import polyline from "polyline";

import 'mapbox-gl/dist/mapbox-gl.css';

import MarkerMenu from './components/MarkerMenu';
import './vita-env.d.ts';  // environment variables
import './App.css';
import axios from 'axios';

import mapboxgl from 'mapbox-gl';

const convertToGeoJSON = (encodedPolyline) => {
  // Decode the polyline into an array of [latitude, longitude] pairs
  const decodedCoordinates = polyline.decode(encodedPolyline, 5);

  // Reverse to [longitude, latitude] for GeoJSON compatibility
  const geoJSONCoordinates = decodedCoordinates.map(([lat, lng]) => [lng, lat]);

  // Construct the GeoJSON object
  return {
    type: "LineString",
    coordinates: geoJSONCoordinates,
  };
};

type MarkerData = {
  key: string;
  address: string;
  lat: number;
  lng: number;
}

const optimizeWaypoints = async (waypoints: MarkerData[]) => {
  if (waypoints.length < 2) {
    console.error("Error: At least 2 waypoints are required.");
    return null;
  }

  const origin = `${waypoints[0].lat},${waypoints[0].lng}`;
  const destination = `${waypoints[waypoints.length - 1].lat},${waypoints[waypoints.length - 1].lng}`;

  const remainingWaypoints = waypoints.slice(1, -1);

  const waypointList = remainingWaypoints.map(
    (wp) => `${wp.lat},${wp.lng}`
  ).join("|");

  const url = `http://127.0.0.1:3000/directions`;

  try {
    const response = await axios.get(url, {
      params: {
        origin,
        destination,
        waypoints: waypointList,
      },
    });

    if (response.status === 200) {
      const { routes } = response.data;
      const route = routes[0];

      const geoRoute = convertToGeoJSON(route.overview_polyline.points);

      const waypointOrder = route.waypoint_order || [];
      const optimizedMarkers = waypointOrder.map(
        (index) => remainingWaypoints[index]
      );

      const finalMarkers = [waypoints[0], ...optimizedMarkers, waypoints[waypoints.length - 1]];

      return {
        geometry: geoRoute,
        instructions: route.legs.flatMap((leg) =>
          leg.steps.map((step) => step.html_instructions.replace(/<[^>]*>/g, ""))
        ),
        distance: route.legs.reduce((sum, leg) => sum + leg.distance.value, 0),
        duration: route.legs.reduce((sum, leg) => sum + leg.duration.value, 0),
        legs: route.legs.map((leg, index) => ({
          start: finalMarkers[index]?.address || "Unknown Start",
          end: finalMarkers[index + 1]?.address || "Unknown End",
          steps: leg.steps.map((step) => ({
            instruction: step.html_instructions.replace(/<[^>]*>/g, ""),
            distance: step.distance.text,
            duration: step.duration.text,
          })),
        })),
        optimizedMarkers: finalMarkers,
      };
    } else {
      console.error("Error fetching directions:", response.data);
    }
  } catch (error) {
    console.error("Error with Google Maps Directions API:", error);
  }
  return null;
};

const MapboxMap = ({ markers, route, legs, currentWaypointIndex }: { markers: MarkerData[]; route: any; legs: any[]; currentWaypointIndex: number }) => {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markerRefs = useRef<mapboxgl.Marker[]>([]);
  const temporaryMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const markerElementsRef = useRef<HTMLDivElement[]>([]);
  const markerPopupsRef = useRef<mapboxgl.Popup[]>([]);
  const reverseGeocode = async (lng: number, lat: number): Promise<string | null> => {
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${mapboxgl.accessToken}`;

    try {
      const response = await axios.get(url);
      if (response.status === 200 && response.data.features.length > 0) {
        return response.data.features[0].place_name; // Return the first result
      }
    } catch (error) {
      console.error("Error reverse geocoding:", error);
    }

    return null;
  };

  useEffect(() => {
    if (map.current) return;

    const initializeMap = async () => {
      try {
        const response = await axios.get("http://127.0.0.1:3000/get_mapbox_token");
        const { mapbox_token } = response.data;

        if (!mapbox_token) {
          console.error("Failed to retrieve Mapbox token");
          return;
        }

        mapboxgl.accessToken = mapbox_token;
        map.current = new mapboxgl.Map({
          container: mapContainer.current as HTMLElement,
          style: "mapbox://styles/mapbox/streets-v11",
          center: [-79.7196, 43.2272],      // hamilton
          zoom: 15,
        });

        // Add built-in navigation control (includes compass rose)
        const navControl = new mapboxgl.NavigationControl({ visualizePitch: true });
        map.current.addControl(navControl, "top-right"); // Position it at the top-right corner
        // Remove temp marker on next map click
        map.current.on("click", () => {
          if (temporaryMarkerRef.current) {
            temporaryMarkerRef.current.remove();
            temporaryMarkerRef.current = null;
          }
        })

      } catch (error) {
        console.error("Error fetching Mapbox token:", error);
      }
    };

    initializeMap();
    return () => map.current?.remove();
  }, []);

  useEffect(() => {
    if (!map.current) return;
    markerElementsRef.current = [];
    markerPopupsRef.current = [];
    // Clear existing markers
    markerRefs.current.forEach((marker) => marker.remove());
    markerRefs.current = []; // Reset the markerRefs array
    // Utility function to close all open popups
    const closeAllPopups = () => {
      markerPopupsRef.current.forEach((popup) => popup.remove());
      if (temporaryMarkerRef.current) {
        temporaryMarkerRef.current.remove();
        temporaryMarkerRef.current = null;
      }
    };
    // Add new markers
    markers.forEach((marker, index) => {
      const isCurrent = index === currentWaypointIndex;
      const isNext = index === currentWaypointIndex + 1;

      const markerColor = isCurrent
        ? "green"
        : isNext
          ? "blue"
          : "purple";

      const popup = new mapboxgl.Popup().setText(marker.address);
      const newMarker = new mapboxgl.Marker({ color: markerColor })
        .setLngLat([marker.lng, marker.lat])
        .setPopup(popup) // Attach popup
        .addTo(map.current!);/*  */

      markerPopupsRef.current.push(popup);

      markerRefs.current.push(newMarker); // Store reference to the marker
      newMarker.getElement().addEventListener('click', (e) => {
        e.stopPropagation();

        closeAllPopups();
        map.current?.flyTo({
          center: [marker.lng, marker.lat],
          zoom: 15,
          essential: true,
        });

        popup.addTo(map.current!);
      });


      // Map clicked -> make a temp marker (testing purposes only)
      map.current?.on("click", async (event) => {
        const clickedElement = event.originalEvent.target as HTMLElement;
        const isMarkerClick = markerElementsRef.current.some((markerElement) =>
          markerElement.contains(clickedElement)

        );
        if (isMarkerClick) {
          return;
        }

        closeAllPopups();
        const { lng, lat } = event.lngLat;
        // Reverse geocode
        const address = await reverseGeocode(lng, lat);
        // setClickedLocation({ lng, lat, address });

        if (temporaryMarkerRef.current) {
          temporaryMarkerRef.current.remove();
        }

        // Create a temp marker
        const popup = new mapboxgl.Popup({ offset: 25 }).setHTML(
          `<div>
          <h4>Clicked Location</h4>
          <p><strong>Address:</strong> ${address}</p>
        </div>`
        )
        const tempMarker = new mapboxgl.Marker({ color: "red" })
          .setLngLat([lng, lat])
          .setPopup(popup)
          .addTo(map.current!);

        // open popup
        popup.on("open", () => {
          const popupElement = popup.getElement();
          if (popupElement) {
            const closeButton = popupElement.querySelector(".mapboxgl-popup-close-button") as HTMLButtonElement;
            if (closeButton) {
              closeButton.removeAttribute("aria-hidden"); // Remove aria-hidden
            }
          }
        });
        if (map.current) {
          tempMarker.getPopup()?.addTo(map.current);
        }

        temporaryMarkerRef.current = tempMarker;
      });
    });
  }, [markers, currentWaypointIndex]);

  useEffect(() => {
    if (!map.current) return;

    if (!route || markers.length < 2) {
      if (map.current.getLayer("routeLine")) {
        map.current.removeLayer("routeLine");
      }
      if (map.current.getSource("routeLine")) {
        map.current.removeSource("routeLine");
      }
      return; // Exit the effect early since there's no route to draw
    } else if (!map.current.getSource("routeLine")) {
      map.current.addSource("routeLine", {
        type: "geojson",
        data: {
          type: "Feature",
          geometry: route, // Use the geometry from the Directions API
          properties: {}
        },
      });

      map.current.addLayer({
        id: "routeLine",
        type: "line",
        source: "routeLine",
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
        paint: {
          "line-color": "#0074D9",
          "line-width": 4,
        },
      });
    } else {
      // Update the routeLine data
      (map.current.getSource("routeLine") as mapboxgl.GeoJSONSource).setData({
        type: "Feature",
        geometry: route, // Use the updated geometry
        properties: {},
      });
    }

  }, [route, markers, legs, currentWaypointIndex]);

  return (
    <div ref={mapContainer} style={{ width: "100%", height: "400px" }} />
  );
};

const App = () => {
  const [markers, setMarkers] = useState<MarkerData[]>([]);
  const [currentWaypointIndex, setCurrentWaypointIndex] = useState(0);
  const [routeData, setRouteData] = useState<{
    geometry: any; instructions: string[];
    distance: number;
    duration: number;
    legs: any[];
  } | null>(null);
  const [selectedStartLocation, setSelectedStartLocation] = useState<string>("");

  const handleNextStop = async () => {
    if (currentWaypointIndex < markers.length - 1 && routeData?.legs) {
      setCurrentWaypointIndex((prevIndex) => prevIndex + 1);
    }
  };

  useEffect(() => {
    fetchMarkers();
  }, []);

  const fetchMarkers = async () => {
    try {
      const response = await axios.get("http://127.0.0.1:3000/get_markers");
      const fetchedMarkers = response.data;
      if (!selectedStartLocation) {
        setSelectedStartLocation(fetchedMarkers[0].address);
      }

      if (fetchedMarkers.length < 2) {
        setMarkers(fetchedMarkers);
        setRouteData(null); // Clear the route if less than 2 markers
      } else {
        console.log("fetched markers:", fetchedMarkers);
        const optimizedData = await optimizeWaypoints(fetchedMarkers);
        if (optimizedData) {
          console.log("Setting optimized routeData:", optimizedData);
          setMarkers(optimizedData.optimizedMarkers);

          setRouteData(optimizedData);
        }
      }
    } catch (error) {
      console.error("Error fetching markers:", error);
    }
  };

  useEffect(() => {
    fetchMarkers();
  }, []);

  useEffect(() => {
    const fetchUpdatedRoute = async () => {
      if (markers.length < 2) {
        setRouteData(null); // Clear route if there are less than 2 markers
        console.log("less than 2");
        return;
      }
      else {
        if (!selectedStartLocation) {
          setSelectedStartLocation(markers[0].address);
        }


        const directions = await optimizeWaypoints(markers);
        setRouteData(directions);
      }
    };

    fetchUpdatedRoute();
  }, [markers]); // Depend on markers state

  useEffect(() => {
    if (selectedStartLocation) {
      // update route
      const updateRoute = async () => {
        if (markers.length > 1) {
          let originMarker = markers.find(marker => marker.address === selectedStartLocation);
          let destinationMarker = markers.find(marker => marker.address);
          if (!originMarker) {
            originMarker = markers[0];
          }
          if (!destinationMarker) {
            destinationMarker = markers[markers.length - 1];
          }
          const directionsData = await optimizeWaypoints(markers);
          setRouteData(directionsData);
        } else {
          setRouteData(null);
        }
      };
      updateRoute();
      setCurrentWaypointIndex(0);
    }
  }, [selectedStartLocation])

  const deleteMarker = async (address: string) => {
    try {
      await axios.post(
        "http://127.0.0.1:3000/delete_marker",
        { address: address },
        {
          headers: {
            "Content-Type": "application/json",
          },
        });

      // Fetch updated optimized route
      const updatedMarkers = markers.filter((marker) => marker.address !== address);
      setMarkers(updatedMarkers);

      // Fetch updated optimized route
      if (updatedMarkers.length < 2) {
        setRouteData(null);
        setCurrentWaypointIndex(0); // Reset to the first waypoint
      }
      else {
        const updatedRouteData = await optimizeWaypoints(updatedMarkers);
        setRouteData(updatedRouteData); // Update route data
        setCurrentWaypointIndex(0); // Reset to the first waypoint
      }
    } catch (error) {
      console.error("Error deleting marker:", error);
    }
  }

  const reorderMarkers = (newStartKey: string): MarkerData[] => {
    const startMarker = markers.find((marker) => marker.address === newStartKey);
    if (!startMarker) {
      console.error("Start marker not found.");
      return markers;
    }

    // Reorder markers so the selected start marker comes first
    const reorderedMarkers = [
      startMarker,
      ...markers.filter((marker) => marker.address !== newStartKey),
    ];

    console.log("reordering");

    setMarkers(reorderedMarkers);
    return reorderedMarkers;
  };

  const handleChangeRoute = async (newStartKey: string) => {
    setSelectedStartLocation(newStartKey);

    // Reorder markers with the selected start marker
    const reorderedMarkers = reorderMarkers(newStartKey);

    // Pass reordered markers to optimizeWaypoints
    if (reorderedMarkers.length > 1) {
      const updatedRouteData = await optimizeWaypoints(reorderedMarkers);
      if (updatedRouteData) {
        setRouteData(updatedRouteData);
      } else {
        setRouteData(null);
      }
    } else {
      setRouteData(null);
    }
  };

  return (
    <div className="app-container">
      <div className="map-container">
        <h2 style={{ marginBottom: "20px", textAlign: "center" }}>Trip Configuration</h2>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "20px" }}>
          <div style={{ flex: 1, marginRight: "10px" }}>
            <label htmlFor="start-location" style={{ fontWeight: "bold", display: "block", marginBottom: "5px" }}>
              Select Starting Location:
            </label>
            <select
              id="start-location"
              value={selectedStartLocation}
              onChange={(e) => {
                const newStartKey = e.target.value;
                handleChangeRoute(newStartKey);
              }}
              style={{
                width: "100%",
                padding: "10px",
                borderRadius: "5px",
                border: "1px solid #ccc",
              }}
            >
              <option value="">-- Choose a Starting Point --</option>
              {markers.map((marker) => (
                <option key={marker.address} value={marker.address}>
                  {marker.address}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div style={{ margin: "20px 0", padding: "20px", border: "1px solid #ccc", borderRadius: "10px", backgroundColor: "#f9f9f9" }}>
          <h3>Ordered Stops</h3>
          <ul>
            {markers.map((marker, index) => (
              <li key={marker.address}>
                {index + 1}. {marker.address}
              </li>
            ))}
          </ul>
          <button
            onClick={() => {
              const stopsList = markers.map((marker, index) => `${index + 1}. ${marker.address}`).join("\n");
              navigator.clipboard.writeText(stopsList);
              alert("Stops copied to clipboard!");
            }}
            style={{
              padding: "10px 20px",
              backgroundColor: "#4CAF50",
              color: "white",
              border: "none",
              borderRadius: "5px",
              cursor: "pointer",
              marginTop: "10px",
            }}
          >
            Copy Stops to Clipboard
          </button>

        </div>
        <div className="info-container">
          <h2>Trip Information</h2>
          {routeData && (
            <div>
              <p>
                <strong>Distance:</strong> {(routeData.distance / 1000).toFixed(2)} km
              </p>
              <p>
                <strong>Duration:</strong> {Math.floor(routeData.duration / 60)} mins
              </p>
            </div>
          )}
        </div>
        <MarkerMenu fetchMarkers={fetchMarkers} optimizeWaypoints={optimizeWaypoints} />
        <MarkerTable markers={markers} onDelete={deleteMarker} />
        <div className="controls">
          <button
            onClick={handleNextStop}
            disabled={currentWaypointIndex >= markers.length - 1}
            style={{
              padding: "10px 20px",
              backgroundColor: currentWaypointIndex >= markers.length - 1 ? "#ccc" : "#4CAF50",
              color: "white",
              border: "none",
              borderRadius: "5px",
              cursor: currentWaypointIndex >= markers.length - 1 ? "not-allowed" : "pointer",
            }}
          >
            Next Stop
          </button>
        </div>
        <MapboxMap markers={markers} route={routeData?.geometry} legs={routeData?.legs || []} currentWaypointIndex={currentWaypointIndex} />
      </div>
      <div className="instructions-container">
        <h2>Directions for Current Segment</h2>
        {routeData?.legs && currentWaypointIndex < routeData.legs.length ? (
          <div>
            <strong>
              From {routeData.legs[currentWaypointIndex].start} to{" "}
              {routeData.legs[currentWaypointIndex].end}
            </strong>
            <ul>
              {routeData.legs[currentWaypointIndex].steps.map((step, index) => (
                <li key={index}>{step.instruction}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p>No instructions available.</p>
        )}
      </div>
    </div>
  );
}

const MarkerTable = ({ markers, onDelete }: { markers: MarkerData[]; onDelete: (key: string) => void }) => {
  return (
    <div style={{ flex: 1, marginRight: '20px' }}>
      <h3>Addresses</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th>Order</th>
            <th>Address</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {markers.map((marker, index) => (
            <tr key={marker.address}>
              <td>{index + 1}</td>
              <td>{marker.address}</td>
              <td>
                <button onClick={() => onDelete(marker.address)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default App;