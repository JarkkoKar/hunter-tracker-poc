import React, { useState, useMemo, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  StatusBar,
  Dimensions,
} from 'react-native';
import MapView, { Polygon, Marker, UrlTile } from 'react-native-maps';
import * as Location from 'expo-location';
import { parseOmaRiistaGeoJSON, Stand } from './src/utils/omariistaParser';
import {
  calculateDangerZones,
  generateSectorPolygonCoordinates,
  findNearestStand,
  calculateDistanceMeters,
  Coordinates,
} from './src/utils/safetySector';
import {
  createInitialHunterState,
  selectStand,
  setHunterReady,
  reportShotFired,
  resolveShotOutcome,
  cancelShotReport,
} from './src/utils/huntingState';
import { getTopoTileConfig } from './src/utils/mapTiles';
import {
  ActiveProfile,
  getProfileConfig,
  formatCoordinatesForProfile,
} from './src/utils/profileEngine';
import {
  RadioTxMode,
  createInitialEmconState,
  setRadioTxMode,
  canTransmitPacket,
} from './src/utils/emconState';
import {
  TransportBearer,
  createInitialTransportState,
  connectUsbSerial,
  disconnectUsbSerial,
  setCellularHealth,
  routeOutgoingPacket,
} from './src/utils/transportManager';

const { width } = Dimensions.get('window');

const MOCK_OMARIISTA_GEOJSON = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [24.0, 61.0],
            [24.1, 61.0],
            [24.1, 61.1],
            [24.0, 61.1],
            [24.0, 61.0],
          ],
        ],
      },
      properties: { name: 'Hirvilohko 1 (Pohjoinen)' },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [24.05, 61.05] },
      properties: { id: 'p1', name: 'P1 Kuusikko' },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [24.05, 61.06] },
      properties: { id: 'p2', name: 'P2 Kallio (Pohjoinen)' },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [24.07, 61.05] },
      properties: { id: 'p3', name: 'P3 Tiehaara (Itä)' },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [24.03, 61.05] },
      properties: { id: 'p4', name: 'P4 Oja (Länsi)' },
    },
  ],
};

export default function App() {
  const [activeProfile, setActiveProfile] = useState<ActiveProfile>(
    ActiveProfile.HUNTER
  );
  const [emconState, setEmconState] = useState(() => createInitialEmconState());
  const [transportState, setTransportState] = useState(() =>
    createInitialTransportState()
  );
  const [lastTxLog, setLastTxLog] = useState<string>(
    'Valmis lähetykseen (4G/5G ensisijainen)'
  );
  const [hunterState, setHunterState] = useState(() =>
    createInitialHunterState('Passimies 1')
  );
  const [userLocation, setUserLocation] = useState<Coordinates | null>(null);
  const [gpsStatus, setGpsStatus] = useState<string>('Haetaan GPS-yhteyttä...');
  const [showTopoLayer, setShowTopoLayer] = useState<boolean>(true);

  const profileConfig = useMemo(
    () => getProfileConfig(activeProfile),
    [activeProfile]
  );

  const txAllowed = useMemo(() => canTransmitPacket(emconState), [emconState]);

  const tileConfig = useMemo(
    () => getTopoTileConfig(process.env.EXPO_PUBLIC_MML_API_KEY),
    []
  );

  const huntingArea = useMemo(
    () => parseOmaRiistaGeoJSON(MOCK_OMARIISTA_GEOJSON),
    []
  );

  const selectedStand = useMemo(
    () => huntingArea.stands.find((s) => s.id === hunterState.currentStandId),
    [huntingArea, hunterState.currentStandId]
  );

  const dangerZones = useMemo(() => {
    if (!selectedStand) return [];
    return calculateDangerZones(selectedStand, huntingArea.stands);
  }, [selectedStand, huntingArea.stands]);

  const dispatchTelemetryEvent = (eventCode: number, label: string) => {
    const dummyBinaryPayload = new Uint8Array([0x48, 0x54, eventCode, 0x01]);
    const result = routeOutgoingPacket(
      transportState,
      emconState,
      dummyBinaryPayload
    );

    const timeStr = new Date().toLocaleTimeString();
    if (result.dispatched) {
      setLastTxLog(
        `${timeStr} | ${label} -> ${result.bearerUsed} (${result.payloadBytes} B)`
      );
    } else {
      setLastTxLog(`${timeStr} | ESTETTY (${result.reason})`);
    }
  };

  useEffect(() => {
    let subscriber: Location.LocationSubscription | null = null;

    async function initGPS() {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          setGpsStatus('GPS-lupa evätty');
          return;
        }

        setGpsStatus('GPS aktiivinen');

        subscriber = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            timeInterval: 3000,
            distanceInterval: 5,
          },
          (loc) => {
            const coords = {
              latitude: loc.coords.latitude,
              longitude: loc.coords.longitude,
            };
            setUserLocation(coords);

            const nearest = findNearestStand(coords, huntingArea.stands, 50);
            if (nearest && nearest.stand.id !== hunterState.currentStandId) {
              setHunterState((prev) =>
                selectStand(prev, nearest.stand.id, nearest.stand.name)
              );
            }
          }
        );
      } catch {
        setGpsStatus('GPS-virhe');
      }
    }

    initGPS();

    return () => {
      if (subscriber) subscriber.remove();
    };
  }, [huntingArea.stands, hunterState.currentStandId]);

  const simulateStandArrival = (stand: Stand) => {
    const simulatedCoords = {
      latitude: stand.latitude + 0.00015,
      longitude: stand.longitude,
    };
    setUserLocation(simulatedCoords);

    const nearest = findNearestStand(simulatedCoords, huntingArea.stands, 50);
    if (nearest) {
      setHunterState((prev) =>
        selectStand(prev, nearest.stand.id, nearest.stand.name)
      );
      dispatchTelemetryEvent(0x10, `AUTO-PASSI ${nearest.stand.id}`);
    }
  };

  const toggleCellularOutage = () => {
    const nextState = setCellularHealth(
      transportState,
      !transportState.cellularAvailable,
      transportState.cellularAvailable ? 5000 : 80
    );
    setTransportState(nextState);
    setLastTxLog(
      nextState.cellularAvailable
        ? '4G/5G yhteys palautettu -> Ensisijainen IP-reititys'
        : '4G/5G katve -> Automaattinen pudotus 868 MHz LoRa Meshiin'
    );
  };

  const toggleUsbZeroRf = () => {
    if (!transportState.usbSerialConnected) {
      const { state, adminCommand } = connectUsbSerial(transportState, 115200);
      setTransportState(state);
      setLastTxLog(`USB-C (115200 bps) kytketty | Lähetetty: ${adminCommand}`);
    } else {
      const state = disconnectUsbSerial(transportState);
      setTransportState(state);
      setLastTxLog('USB-C irrotettu | Radion 2.4 GHz BLE palautettu');
    }
  };

  const initialRegion = {
    latitude: 61.055,
    longitude: 24.05,
    latitudeDelta: 0.03,
    longitudeDelta: 0.05,
  };

  const safeSectorCoords = useMemo(() => {
    if (!selectedStand) return [];
    return generateSectorPolygonCoordinates(selectedStand, 300, 60, 450);
  }, [selectedStand]);

  const dangerZonePolygons = useMemo(() => {
    if (!selectedStand) return [];
    return dangerZones.map((zone) => ({
      standId: zone.standId,
      coordinates: generateSectorPolygonCoordinates(
        selectedStand,
        zone.startAngle,
        zone.endAngle,
        500
      ),
    }));
  }, [selectedStand, dangerZones]);

  const handleSelectStand = (stand: Stand) => {
    setHunterState((prev) => selectStand(prev, stand.id, stand.name));
    dispatchTelemetryEvent(0x11, `VALINTA ${stand.id}`);
  };

  const handleReady = () => {
    if (!txAllowed) return;
    setHunterState((prev) => setHunterReady(prev));
    dispatchTelemetryEvent(0x12, 'VALMIS');
  };

  const handleShotFired = () => {
    if (!txAllowed) return;
    setHunterState((prev) => reportShotFired(prev));
    dispatchTelemetryEvent(0x20, 'LAUKAUS');
  };

  const handleOutcome = (outcome: 'HARVEST' | 'MISS' | 'WOUNDED') => {
    if (!txAllowed) return;
    setHunterState((prev) => resolveShotOutcome(prev, outcome));
    dispatchTelemetryEvent(0x21, `TULOS:${outcome}`);
  };

  const handleCancelShot = () => setHunterState((prev) => cancelShotReport(prev));

  const lastShotLabel = hunterState.lastShot
    ? `Viimeisin ilmoitus: ${hunterState.lastShot.outcome} (${new Date(
        hunterState.lastShot.timestamp
      ).toLocaleTimeString()})`
    : '';

  const distanceToCurrentStand = useMemo(() => {
    if (!userLocation || !selectedStand) return null;
    return Math.round(calculateDistanceMeters(userLocation, selectedStand));
  }, [userLocation, selectedStand]);

  const formattedUserCoords = useMemo(() => {
    const target = userLocation || selectedStand;
    if (!target) return 'Ei sijaintia';
    return formatCoordinatesForProfile(target, activeProfile);
  }, [userLocation, selectedStand, activeProfile]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Text style={[styles.appName, { color: profileConfig.accentColor }]}>
            HunterTrackerLight // {profileConfig.id}
          </Text>
          <Text style={styles.subTitle}>
            {profileConfig.areaLabel}: {huntingArea.boundary?.name || 'Alue 1'} |{' '}
            {gpsStatus}
          </Text>
          <Text style={styles.coordDisplay}>
            [{profileConfig.coordinateSystem}] {formattedUserCoords}
          </Text>
        </View>

        {/* Profiilivalitsin: HUNTER / SAR / TACTICAL */}
        <View style={styles.profileRow}>
          {[ActiveProfile.HUNTER, ActiveProfile.SAR, ActiveProfile.TACTICAL].map(
            (prof) => {
              const isSelected = activeProfile === prof;
              const cfg = getProfileConfig(prof);
              return (
                <TouchableOpacity
                  key={prof}
                  style={[
                    styles.profileChip,
                    isSelected && {
                      backgroundColor: cfg.accentColor,
                      borderColor: '#FFFFFF',
                    },
                  ]}
                  onPress={() => setActiveProfile(prof)}
                >
                  <Text
                    style={[
                      styles.profileChipText,
                      isSelected && { color: '#0A0E0A', fontWeight: 'bold' },
                    ]}
                  >
                    {prof}
                  </Text>
                </TouchableOpacity>
              );
            }
          )}
        </View>

        {/* Hybridi & Zero-RF Siirtokerroksen ohjaus */}
        <View style={styles.transportCard}>
          <View style={styles.transportHeaderRow}>
            <Text style={styles.transportTitle}>
              SIIRTOTIE: [{transportState.activeBearer}]
            </Text>
            <Text
              style={[
                styles.bleBadge,
                transportState.radioBleDisabled && styles.bleDisabledBadge,
              ]}
            >
              {transportState.radioBleDisabled
                ? 'BLE: OFF (ZERO-RF)'
                : 'BLE: STANDBY'}
            </Text>
          </View>

          <Text style={styles.txLogText}>{lastTxLog}</Text>

          <View style={styles.transportButtonsRow}>
            <TouchableOpacity
              style={[
                styles.transportToggleBtn,
                !transportState.cellularAvailable && styles.transportWarnBtn,
              ]}
              onPress={toggleCellularOutage}
            >
              <Text style={styles.transportBtnText}>
                {transportState.cellularAvailable
                  ? '4G/5G: OK (Simuloi katve)'
                  : '4G/5G: KATVE (LoRa aktiivinen)'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.transportToggleBtn,
                transportState.usbSerialConnected && styles.transportZeroRfBtn,
              ]}
              onPress={toggleUsbZeroRf}
            >
              <Text style={styles.transportBtnText}>
                {transportState.usbSerialConnected
                  ? 'USB-C 115200: KYTKETTY'
                  : 'Kytke USB-C (Zero-RF)'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* EMCON-radiokurin ohjauspalkki */}
        <View
          style={[
            styles.emconCard,
            emconState.mode === RadioTxMode.NORMAL && styles.emconNormal,
            emconState.mode === RadioTxMode.BURST_MANUAL && styles.emconBurst,
            emconState.mode === RadioTxMode.RX_ONLY && styles.emconRxOnly,
          ]}
        >
          <View style={styles.emconHeaderRow}>
            <Text style={styles.emconTitle}>
              EMCON RADIOKURI: [{emconState.mode}]
            </Text>
            <Text style={styles.emconSub}>
              {emconState.mode === RadioTxMode.RX_ONLY
                ? 'TX LUKITTU (VAIN KUUNTELU)'
                : 'LÄHETYS SALLITTU'}
            </Text>
          </View>

          <View style={styles.emconButtonsRow}>
            {emconState.mode !== RadioTxMode.RX_ONLY ? (
              <>
                <TouchableOpacity
                  style={styles.emconBurstBtn}
                  onPress={() =>
                    setEmconState((prev) =>
                      setRadioTxMode(
                        prev,
                        prev.mode === RadioTxMode.NORMAL
                          ? RadioTxMode.BURST_MANUAL
                          : RadioTxMode.NORMAL,
                        true
                      )
                    )
                  }
                >
                  <Text style={styles.emconBtnText}>
                    {emconState.mode === RadioTxMode.NORMAL
                      ? 'Vaihda BURST_MANUAL'
                      : 'Vaihda NORMAL'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.emconSilenceBtn}
                  onPress={() =>
                    setEmconState((prev) =>
                      setRadioTxMode(prev, RadioTxMode.RX_ONLY, true)
                    )
                  }
                >
                  <Text style={styles.emconBtnText}>ASETA RX_ONLY (HILJAISUUS)</Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity
                style={styles.emconUnlockBtn}
                delayLongPress={2000}
                onLongPress={() =>
                  setEmconState((prev) =>
                    setRadioTxMode(prev, RadioTxMode.NORMAL, true)
                  )
                }
              >
                <Text style={styles.emconBtnText}>
                  PAINA 2 SEKUNTIA PALAUTTAAKSESI LÄHETYKSEN (NORMAL)
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Tilakortti */}
        <View
          style={[
            styles.statusCard,
            { borderLeftColor: profileConfig.accentColor },
            hunterState.status === 'SHOT_FIRED' && styles.statusShot,
            hunterState.status === 'WOUNDED' && styles.statusWounded,
          ]}
        >
          <Text style={styles.statusLabel}>TILANNE:</Text>
          <Text style={styles.statusValue}>[{hunterState.status}]</Text>
          {hunterState.standName && (
            <Text style={styles.statusStand}>
              {profileConfig.nodeLabel}: {hunterState.standName}
              {distanceToCurrentStand !== null
                ? ` (etäisyys ${distanceToCurrentStand} m)`
                : ''}
            </Text>
          )}
          {hunterState.lastShot && (
            <Text style={styles.lastShotText}>{lastShotLabel}</Text>
          )}
        </View>

        {/* Karttanäkymä */}
        <View style={styles.mapContainer}>
          <View style={styles.mapHeaderRow}>
            <Text style={[styles.sectionTitle, { color: profileConfig.accentColor }]}>
              KARTTA: {showTopoLayer ? tileConfig.label.toUpperCase() : 'PERUSKARTTA'}
            </Text>
            <TouchableOpacity
              style={[
                styles.layerToggleButton,
                { borderColor: profileConfig.accentColor },
              ]}
              onPress={() => setShowTopoLayer((prev) => !prev)}
            >
              <Text style={styles.layerToggleText}>
                {showTopoLayer ? 'Maastokartta: PÄÄLLÄ' : 'Maastokartta: POIS'}
              </Text>
            </TouchableOpacity>
          </View>

          <MapView
            style={styles.map}
            initialRegion={initialRegion}
            mapType={showTopoLayer ? 'none' : 'standard'}
          >
            {showTopoLayer && (
              <UrlTile
                urlTemplate={tileConfig.urlTemplate}
                maximumZ={tileConfig.maximumZ}
                flipY={false}
                zIndex={-1}
              />
            )}

            {huntingArea.boundary && (
              <Polygon
                coordinates={huntingArea.boundary.coordinates}
                strokeColor={profileConfig.accentColor}
                fillColor="rgba(76, 175, 80, 0.12)"
                strokeWidth={2}
              />
            )}

            {safeSectorCoords.length > 0 && (
              <Polygon
                coordinates={safeSectorCoords}
                strokeColor="#2E7D32"
                fillColor="rgba(46, 125, 50, 0.35)"
                strokeWidth={1}
              />
            )}

            {dangerZonePolygons.map((dz) => (
              <Polygon
                key={dz.standId}
                coordinates={dz.coordinates}
                strokeColor="#D32F2F"
                fillColor="rgba(211, 47, 47, 0.45)"
                strokeWidth={1}
              />
            ))}

            {huntingArea.stands.map((stand) => {
              const isSelected = stand.id === hunterState.currentStandId;
              return (
                <Marker
                  key={stand.id}
                  coordinate={{
                    latitude: stand.latitude,
                    longitude: stand.longitude,
                  }}
                  title={stand.name}
                  pinColor={isSelected ? 'green' : 'orange'}
                  onPress={() => handleSelectStand(stand)}
                />
              );
            })}

            {userLocation && (
              <Marker
                coordinate={userLocation}
                title="Oma sijainti"
                pinColor="blue"
              />
            )}
          </MapView>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: profileConfig.accentColor }]}>
            GPS-AUTOMAATTI / TESTAUS
          </Text>
          <TouchableOpacity
            style={styles.simButton}
            onPress={() => simulateStandArrival(huntingArea.stands[0])}
            activeOpacity={0.7}
          >
            <Text style={styles.simButtonText}>
              Simuloi: Saavu kohteeseen P1 Kuusikko (&lt; 20 m)
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: profileConfig.accentColor }]}>
            1. VALITSE {profileConfig.nodeLabel.toUpperCase()}
          </Text>
          <View style={styles.standGrid}>
            {huntingArea.stands.map((stand) => {
              const isSelected = stand.id === hunterState.currentStandId;
              return (
                <TouchableOpacity
                  key={stand.id}
                  style={[
                    styles.standButton,
                    isSelected && {
                      backgroundColor: '#2E7D32',
                      borderColor: profileConfig.accentColor,
                    },
                  ]}
                  onPress={() => handleSelectStand(stand)}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.standButtonText,
                      isSelected && styles.standButtonTextActive,
                    ]}
                  >
                    {stand.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {selectedStand && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: profileConfig.accentColor }]}>
              2. SEKTORITURVALLISUUS
            </Text>
            <View style={styles.safetyBox}>
              <Text style={styles.safetyMain}>
                Sallittu pääsektori: vihreä 120°
              </Text>
              <Text style={styles.dangerHeader}>
                Lasketut naapurikieltokulmat (±15°):
              </Text>
              {dangerZones.map((zone) => (
                <View key={zone.standId} style={styles.dangerRow}>
                  <Text style={styles.dangerStand}>{zone.standName}:</Text>
                  <Text style={styles.dangerDegrees}>
                    suunta {Math.round(zone.centerAngle)}° (KIELTO{' '}
                    {Math.round(zone.startAngle)}° - {Math.round(zone.endAngle)}°)
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: profileConfig.accentColor }]}>
            3. TILANNEKUYITTAUS {!txAllowed ? '(ESTETTY: RX_ONLY)' : ''}
          </Text>

          {hunterState.status === 'IN_STAND' && (
            <TouchableOpacity
              style={[
                styles.bigButton,
                txAllowed ? styles.readyButton : styles.disabledButton,
              ]}
              onPress={handleReady}
              disabled={!txAllowed}
              activeOpacity={0.7}
            >
              <Text style={styles.bigButtonText}>
                {profileConfig.readyActionLabel}
              </Text>
            </TouchableOpacity>
          )}

          {hunterState.status === 'READY' && (
            <TouchableOpacity
              style={[
                styles.bigButton,
                txAllowed ? styles.shotButton : styles.disabledButton,
              ]}
              onPress={handleShotFired}
              disabled={!txAllowed}
              activeOpacity={0.7}
            >
              <Text style={styles.bigButtonText}>
                {profileConfig.alertActionLabel}
              </Text>
            </TouchableOpacity>
          )}

          {hunterState.status === 'SHOT_FIRED' && (
            <View style={styles.outcomeContainer}>
              <TouchableOpacity
                style={[
                  styles.bigButton,
                  txAllowed ? styles.harvestButton : styles.disabledButton,
                ]}
                onPress={() => handleOutcome('HARVEST')}
                disabled={!txAllowed}
                activeOpacity={0.7}
              >
                <Text style={styles.bigButtonText}>[KAATO / OK]</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.bigButton,
                  txAllowed ? styles.missButton : styles.disabledButton,
                ]}
                onPress={() => handleOutcome('MISS')}
                disabled={!txAllowed}
                activeOpacity={0.7}
              >
                <Text style={styles.bigButtonText}>[OHI / EI HAVAINTOA]</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.bigButton,
                  txAllowed ? styles.woundedButton : styles.disabledButton,
                ]}
                onPress={() => handleOutcome('WOUNDED')}
                disabled={!txAllowed}
                activeOpacity={0.7}
              >
                <Text style={styles.bigButtonText}>[HAAVAKKO / HÄTÄ]</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.cancelButton}
                onPress={handleCancelShot}
                activeOpacity={0.7}
              >
                <Text style={styles.cancelButtonText}>Peruuta ilmoitus</Text>
              </TouchableOpacity>
            </View>
          )}

          {(hunterState.status === 'HARVEST' ||
            hunterState.status === 'WOUNDED') && (
            <TouchableOpacity
              style={[
                styles.bigButton,
                txAllowed ? styles.readyButton : styles.disabledButton,
                { marginTop: 12 },
              ]}
              onPress={handleReady}
              disabled={!txAllowed}
              activeOpacity={0.7}
            >
              <Text style={styles.bigButtonText}>[PALAA VALMIUTEEN]</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0A0E0A',
  },
  container: {
    padding: 16,
    paddingBottom: 40,
  },
  header: {
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1F291F',
    paddingBottom: 8,
  },
  appName: {
    fontSize: 20,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  subTitle: {
    fontSize: 13,
    color: '#B0C4B0',
    marginTop: 2,
  },
  coordDisplay: {
    fontSize: 13,
    fontFamily: 'monospace',
    color: '#FFF59D',
    marginTop: 4,
  },
  profileRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  profileChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 6,
    backgroundColor: '#161E16',
    borderWidth: 1,
    borderColor: '#2E3D2E',
    alignItems: 'center',
  },
  profileChipText: {
    color: '#C8E6C9',
    fontSize: 13,
    fontWeight: '600',
  },
  transportCard: {
    backgroundColor: '#111A22',
    borderRadius: 8,
    padding: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#2196F3',
  },
  transportHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  transportTitle: {
    color: '#90CAF9',
    fontSize: 13,
    fontWeight: 'bold',
  },
  bleBadge: {
    backgroundColor: '#1E3A5F',
    color: '#BBDEFB',
    fontSize: 10,
    fontWeight: 'bold',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  bleDisabledBadge: {
    backgroundColor: '#4A148C',
    color: '#F3E5F5',
  },
  txLogText: {
    color: '#CFD8DC',
    fontSize: 11,
    fontFamily: 'monospace',
    marginBottom: 8,
  },
  transportButtonsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  transportToggleBtn: {
    flex: 1,
    backgroundColor: '#1976D2',
    paddingVertical: 9,
    paddingHorizontal: 6,
    borderRadius: 6,
    alignItems: 'center',
  },
  transportWarnBtn: {
    backgroundColor: '#E65100',
  },
  transportZeroRfBtn: {
    backgroundColor: '#6A1B9A',
  },
  transportBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  emconCard: {
    borderRadius: 8,
    padding: 12,
    marginBottom: 14,
    borderWidth: 1,
  },
  emconNormal: {
    backgroundColor: '#0F2414',
    borderColor: '#4CAF50',
  },
  emconBurst: {
    backgroundColor: '#2B2108',
    borderColor: '#FFB300',
  },
  emconRxOnly: {
    backgroundColor: '#2E0B0B',
    borderColor: '#EF5350',
  },
  emconHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  emconTitle: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: 'bold',
  },
  emconSub: {
    color: '#E0E0E0',
    fontSize: 11,
    fontWeight: '700',
  },
  emconButtonsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  emconBurstBtn: {
    flex: 1,
    backgroundColor: '#8D6E00',
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
  },
  emconSilenceBtn: {
    flex: 1,
    backgroundColor: '#B71C1C',
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
  },
  emconUnlockBtn: {
    flex: 1,
    backgroundColor: '#C62828',
    paddingVertical: 12,
    borderRadius: 6,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#FFCDD2',
  },
  emconBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  statusCard: {
    backgroundColor: '#161E16',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
    borderLeftWidth: 6,
  },
  statusShot: {
    borderLeftColor: '#FF9800',
    backgroundColor: '#2D1F08',
  },
  statusWounded: {
    borderLeftColor: '#D32F2F',
    backgroundColor: '#300D0D',
  },
  statusLabel: {
    fontSize: 12,
    color: '#A0B0A0',
    fontWeight: '600',
  },
  statusValue: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginVertical: 4,
  },
  statusStand: {
    fontSize: 16,
    color: '#C8E6C9',
  },
  lastShotText: {
    fontSize: 13,
    color: '#FFF59D',
    marginTop: 6,
  },
  mapContainer: {
    marginBottom: 20,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#1C261C',
    backgroundColor: '#121812',
    padding: 8,
  },
  mapHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  layerToggleButton: {
    backgroundColor: '#1E2E1E',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
  },
  layerToggleText: {
    color: '#A5D6A7',
    fontSize: 12,
    fontWeight: '700',
  },
  map: {
    width: width - 48,
    height: 300,
    borderRadius: 6,
  },
  section: {
    marginBottom: 20,
    backgroundColor: '#121812',
    borderRadius: 8,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1C261C',
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  simButton: {
    backgroundColor: '#1565C0',
    paddingVertical: 14,
    borderRadius: 6,
    alignItems: 'center',
  },
  simButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
  standGrid: {
    gap: 8,
  },
  standButton: {
    backgroundColor: '#1B241B',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#2D3E2D',
  },
  standButtonText: {
    color: '#C0D0C0',
    fontSize: 16,
    fontWeight: '600',
  },
  standButtonTextActive: {
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
  safetyBox: {
    backgroundColor: '#182018',
    borderRadius: 6,
    padding: 12,
  },
  safetyMain: {
    color: '#81C784',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  dangerHeader: {
    color: '#EF9A9A',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 4,
    marginBottom: 6,
  },
  dangerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#263326',
  },
  dangerStand: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  dangerDegrees: {
    color: '#FF7043',
    fontSize: 13,
    fontWeight: '700',
  },
  bigButton: {
    minHeight: 64,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 6,
  },
  disabledButton: {
    backgroundColor: '#37474F',
    opacity: 0.55,
  },
  bigButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  readyButton: {
    backgroundColor: '#2E7D32',
  },
  shotButton: {
    backgroundColor: '#E65100',
  },
  outcomeContainer: {
    gap: 8,
  },
  harvestButton: {
    backgroundColor: '#1B5E20',
  },
  missButton: {
    backgroundColor: '#F57F17',
  },
  woundedButton: {
    backgroundColor: '#B71C1C',
  },
  cancelButton: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: '#90A4AE',
    fontSize: 14,
    textDecorationLine: 'underline',
  },
});
