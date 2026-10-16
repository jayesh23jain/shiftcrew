import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { getVenueDistanceText } from '../lib.js';

export function useUserLocation() {
  const { user } = useAuth();
  const [coords, setCoords] = useState(() => {
    try {
      const saved = localStorage.getItem('shiftcrew_user_geo');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [isLocating, setIsLocating] = useState(false);
  const [geoError, setGeoError] = useState(null);

  const detectLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setGeoError('Geolocation is not supported by your browser');
      return;
    }
    setIsLocating(true);
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const c = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        setCoords(c);
        setIsLocating(false);
        try {
          localStorage.setItem('shiftcrew_user_geo', JSON.stringify(c));
        } catch {
          // ignore
        }
      },
      (err) => {
        setIsLocating(false);
        setGeoError(err.message);
      },
      { timeout: 10000, enableHighAccuracy: false }
    );
  }, []);

  useEffect(() => {
    // If no coordinates stored yet, attempt background detection
    if (!coords && typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const c = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
          setCoords(c);
          try {
            localStorage.setItem('shiftcrew_user_geo', JSON.stringify(c));
          } catch {
            // ignore
          }
        },
        () => {},
        { timeout: 6000, maximumAge: 3600000 }
      );
    }
  }, [coords]);

  const getDistance = useCallback(
    (venue) => getVenueDistanceText(venue, coords, user?.city),
    [coords, user?.city]
  );

  return {
    coords,
    city: user?.city,
    detectLocation,
    isLocating,
    geoError,
    getDistance,
  };
}
