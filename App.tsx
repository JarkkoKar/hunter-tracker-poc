import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  StatusBar,
  Dimensions,
  LayoutChangeEvent,
} from 'react-native';
import MapView, { Polygon, Marker, UrlTile } from 'react-native-maps';
import * as Location from 'expo-location';
import { Magnetometer } from 'expo-sensors';
import * as Haptics from 'expo-haptics';
import { createAudioPlayer, setAudioModeAsync, AudioPlayer } from 'expo-audio';
import {
  AudioWarningLevel,
  AUDIO_WARNING_TONES,
  createAudioInterlockState,
  setAudioWarningEnabled,
  shouldPlayAudioWarning,
  generateToneWav,
  bytesToBase64,
  buildToneFileName,
} from './src/utils/audioInterlock';
import { Paths, File, Directory } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import {
  Stand,
  HuntingArea,
  getDefaultTestArea,
  importOmaRiistaFromJsonString,
  calculateAreaCenter,
  isSupportedGeoJsonFileName,
  readImportFileText,
  getAreaPolygons,
  getAreaPoints,
  AreaRegion,
} from './src/utils/omariistaParser';
import {
  createLegacyAreaStorage,
  loadLastUsedArea,
  saveLastUsedArea,
  resetToDefaultArea,
  getDefaultPersistedArea,
  shouldPersistRegion,
  DEFAULT_START_REGION,
} from './src/utils/areaPersistence';
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
import { getTileLayerConfig } from './src/utils/mapTiles';
import {
  DEFAULT_MAP_LAYER,
  MapLayerChoice,
  getMapLayerAttribution,
  getNextMapLayer,
  getOfflineSourceLayer,
  loadMapLayerPreference,
  saveMapLayerPreference,
} from './src/utils/mapLayerPreference';
import {
  planOfflineTileDownload,
  downloadTilesToCache,
  createTileDownloadState,
  getDownloadProgressPercent,
  TileDownloadState,
  TILE_CACHE_DIR_NAME,
  getMaxCachedZoomLevel,
} from './src/utils/offlineTileCache';
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
  createInitialTransportState,
  connectUsbSerial,
  disconnectUsbSerial,
  setCellularHealth,
  routeOutgoingPacket,
} from './src/utils/transportManager';
import {
  NativeUsbSerialModule,
  connectLoraSerial,
} from './src/utils/androidUsbOtgDriver';
import { ISerialPortDriver } from './src/utils/serialPortDriver';
import {
  PacketType,
  encodeEncryptedFrame,
} from './src/utils/wireProtocol';
import {
  TakTargetEndpoint,
  convertFrameToCotXml,
  buildTakDispatchEnvelope,
} from './src/utils/localTakBridge';
import {
  createInitialZeroizeState,
  setZeroizeCoverOpen,
  attemptSlideToZeroize,
} from './src/utils/zeroizeService';
import {
  compressTrackDelta,
  packSearchSector,
  createPrioritySosAlert,
} from './src/utils/sarStructures';
import {
  MapOrientationMode,
  calculateHeadingFromMagnetometer,
  smoothHeading,
  generateViewConeCoordinates,
  getCameraHeadingForMode,
  toggleMapOrientationMode,
  checkHeadingDangerOverlap,
  shouldTriggerHapticAlert,
  HeadingDangerResult,
} from './src/utils/compassHeading';
import {
  getBottomPanelState,
  shouldShowHeadingWarning,
  toggleSheet,
  formatGpsAccuracy,
  formatAreaSummary,
  formatRadioStatus,
  formatHeadingStatus,
  MAP_SCREEN_LAYERS,
  MapSheetId,
} from './src/utils/mapScreenLayout';
import { MapStatusBar } from './src/components/MapStatusBar';
import { MapFabColumn } from './src/components/MapFabColumn';
import { BottomActionPanel, QuickActionId } from './src/components/BottomActionPanel';
import { OverlaySheet } from './src/components/OverlaySheet';
import { SegmentedControl } from './src/components/SegmentedControl';
import {
  getMorePanelFocusSection,
  getMorePanelScrollOffset,
  getMapLayerSegments,
  getEmconSegments,
  EMCON_UNLOCK_LONG_PRESS_MS,
  MorePanelSectionId,
} from './src/utils/morePanel';

const { width } = Dimensions.get('window');

// Natiivi USB-OTG-sarjaporttikirjasto (#25). null = ei asennettu / Expo Go ->
// hallittu pudotus LOOPBACK-SIM-tilaan. Kun react-native-usb-serialport-for-android
// asennetaan Dev Buildiin, tähän kytketään createUsbSerialportAdapter(UsbSerialManager).
const NATIVE_USB_SERIAL_MODULE: NativeUsbSerialModule | null = null;

const SAMPLE_SAR_SECTOR_VERTICES: Coordinates[] = [
  { latitude: 61.012, longitude: 24.527 },
  { latitude: 61.018, longitude: 24.527 },
  { latitude: 61.021, longitude: 24.535 },
  { latitude: 61.018, longitude: 24.543 },
  { latitude: 61.012, longitude: 24.543 },
  { latitude: 61.009, longitude: 24.535 },
];

export default function App() {
  const [activeProfile, setActiveProfile] = useState<ActiveProfile>(
    ActiveProfile.HUNTER
  );
  const [emconState, setEmconState] = useState(() => createInitialEmconState());
  const [transportState, setTransportState] = useState(() =>
    createInitialTransportState()
  );
  const [zeroizeState, setZeroizeState] = useState(() =>
    createInitialZeroizeState('HTL-E2EE-ALPHA-2026', '9911')
  );
  const [lastTxLog, setLastTxLog] = useState<string>(
    'Valmis lähetykseen (E2EE + 4G/5G -> LoRa)'
  );
  const [lastCotPreview, setLastCotPreview] = useState<string>('');
  const [loraDriverLabel, setLoraDriverLabel] = useState<string>('');
  const loraDriverRef = useRef<ISerialPortDriver | null>(null);
  const [showSarSector, setShowSarSector] = useState<boolean>(false);
  const [sosLockedLocation, setSosLockedLocation] = useState<Coordinates | null>(
    null
  );
  const [hunterState, setHunterState] = useState(() =>
    createInitialHunterState('Passimies 1')
  );
  const [userLocation, setUserLocation] = useState<Coordinates | null>(null);
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [openSheet, setOpenSheet] = useState<MapSheetId | null>(null);
  // Lisaa-paneeli (#61): osioiden y-sijainnit vieritysta varten ja EMCON-ohje
  const [moreSectionOffsets, setMoreSectionOffsets] = useState<
    Partial<Record<MorePanelSectionId, number>>
  >({});
  const [emconHint, setEmconHint] = useState<string>('');
  const [gpsStatus, setGpsStatus] = useState<string>('Haetaan GPS-yhteyttä...');
  const [showTopoLayer, setShowTopoLayer] = useState<boolean>(true);
  // Karttataso (#59): oletus OpenTopoMap, valinta tallennetaan pysyvasti
  const [mapLayer, setMapLayer] = useState<MapLayerChoice>(DEFAULT_MAP_LAYER);
  const lastOnlineMapLayerRef = useRef<MapLayerChoice>(DEFAULT_MAP_LAYER);
  const mapLayerChangedByUserRef = useRef<boolean>(false);
  const offlineCacheEnabled = mapLayer === 'offline';
  const [tileDownload, setTileDownload] = useState<TileDownloadState | null>(null);
  const [isDownloadingTiles, setIsDownloadingTiles] = useState<boolean>(false);
  const [storedTileCount, setStoredTileCount] = useState<number>(0);
  const [cachedMaxZoom, setCachedMaxZoom] = useState<number | null>(null);
  const [offlineStatus, setOfflineStatus] = useState<string>('');
  const [orientationMode, setOrientationMode] = useState<MapOrientationMode>(
    MapOrientationMode.NORTH_UP
  );
  const [compassHeading, setCompassHeading] = useState<number | null>(null);
  const [compassAvailable, setCompassAvailable] = useState<boolean | null>(null);
  const mapRef = useRef<MapView>(null);
  const smoothedHeadingRef = useRef<number | null>(null);
  const wasHeadingDangerRef = useRef<boolean>(false);
  const lastHapticAlertAtRef = useRef<number | null>(null);

  const profileConfig = useMemo(
    () => getProfileConfig(activeProfile),
    [activeProfile]
  );

  const txAllowed = useMemo(() => canTransmitPacket(emconState), [emconState]);

  // Offline-latauksen lahde: MML avaimen kanssa, muuten OpenTopoMap (#59).
  // Avain tulee vain ymparistomuuttujasta.
  const onlineTileConfig = useMemo(
    () =>
      getTileLayerConfig(
        getOfflineSourceLayer(process.env.EXPO_PUBLIC_MML_API_KEY),
        process.env.EXPO_PUBLIC_MML_API_KEY
      ),
    []
  );

  // Aktiivinen kerros kayttajan valinnan mukaan; offline -> UrlTile lukee file://-hakemistoa
  const tileConfig = useMemo(
    () =>
      getTileLayerConfig(mapLayer, process.env.EXPO_PUBLIC_MML_API_KEY, {
        offlineCacheRootUri: Paths.document.uri,
        offlineMaxNativeZ: cachedMaxZoom ?? undefined,
      }),
    [mapLayer, cachedMaxZoom]
  );

  const mapAttribution = useMemo(
    () => (tileConfig.id === 'mml-maastokartta' || tileConfig.id === 'opentopomap'
      ? getMapLayerAttribution(tileConfig.id)
      : ''),
    [tileConfig.id]
  );

  // Jahtialue: oletuksena testialue, vaihdettavissa OmaRiista GeoJSON -tuonnilla
  const [huntingArea, setHuntingArea] = useState<HuntingArea>(() => getDefaultTestArea());
  const [areaImportStatus, setAreaImportStatus] = useState<string>('');
  const [isImportingArea, setIsImportingArea] = useState<boolean>(false);
  // Pysyva aluetallennus: documentDirectory/huntertracker_last_area.json
  const areaStorage = useMemo(() => createLegacyAreaStorage(FileSystem), []);
  const areaDocDir = FileSystem.documentDirectory;
  const [startRegion, setStartRegion] = useState<AreaRegion>(() => ({ ...DEFAULT_START_REGION }));
  const [persistedAreaLoaded, setPersistedAreaLoaded] = useState<boolean>(false);
  const areaChangedByUserRef = useRef<boolean>(false);
  const lastPersistedRegionRef = useRef<AreaRegion | null>(null);
  const areaPolygons = useMemo(() => getAreaPolygons(huntingArea), [huntingArea]);

  const selectedStand = useMemo(
    () => huntingArea.stands.find((s) => s.id === hunterState.currentStandId),
    [huntingArea, hunterState.currentStandId]
  );

  const dangerZones = useMemo(() => {
    if (!selectedStand) return [];
    return calculateDangerZones(selectedStand, huntingArea.stands);
  }, [selectedStand, huntingArea.stands]);

  const dispatchEncryptedTelemetry = (
    packetType: PacketType,
    statusCode: number,
    label: string,
    overrideCoords?: Coordinates
  ) => {
    if (zeroizeState.wiped) {
      setLastTxLog('ESTETTY: Laite on ZEROIZED-tilassa (avaimet tyhjennetty)');
      return;
    }

    const coords = overrideCoords ||
      userLocation ||
      selectedStand || { latitude: 61.015, longitude: 24.535 };

    const timestampSec = Math.floor(Date.now() / 1000);
    const payload = {
      senderId: 1,
      packetType,
      latitude: coords.latitude,
      longitude: coords.longitude,
      statusCode,
      timestampSec,
    };

    // 1. E2EE-salattu 44 tavun binäärikehys
    const encryptedFrame = encodeEncryptedFrame(
      payload,
      zeroizeState.activeSecretKey
    );

    // 2. Reititys aktiiviselle siirtotielle (EMCON-valvottu)
    const routeResult = routeOutgoingPacket(
      transportState,
      emconState,
      encryptedFrame
    );

    // 3. CoT XML -käännös paikalliselle ATAK-sillalle
    const cotXml = convertFrameToCotXml(payload, activeProfile);
    const takEnv = buildTakDispatchEnvelope(
      cotXml,
      TakTargetEndpoint.ATAK_MULTICAST
    );
    setLastCotPreview(
      `CoT -> ${takEnv.host}:${takEnv.port} (${cotXml.match(/type="([^"]+)"/)?.[1] || ''})`
    );

    const timeStr = new Date().toLocaleTimeString();
    if (routeResult.dispatched) {
      setLastTxLog(
        `${timeStr} | E2EE ${label} -> ${routeResult.bearerUsed} (${routeResult.payloadBytes} B)`
      );
    } else {
      setLastTxLog(`${timeStr} | ESTETTY (${routeResult.reason})`);
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
            setGpsAccuracy(loc.coords.accuracy ?? null);

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

  // Kompassi: magnetometri -> pehmennetty atsimuutti
  useEffect(() => {
    let subscription: { remove: () => void } | null = null;
    let cancelled = false;

    Magnetometer.isAvailableAsync()
      .then((available) => {
        if (cancelled) return;
        setCompassAvailable(available);
        if (!available) return;

        Magnetometer.setUpdateInterval(100);
        subscription = Magnetometer.addListener(({ x, y }) => {
          const raw = calculateHeadingFromMagnetometer({ x, y });
          const smoothed = smoothHeading(smoothedHeadingRef.current, raw);
          smoothedHeadingRef.current = smoothed;
          // Paivitetaan tila vain >=1 asteen muutoksella (vahemman renderointeja)
          setCompassHeading((prev) =>
            prev === null ||
            Math.abs(((smoothed - prev + 540) % 360) - 180) >= 1
              ? smoothed
              : prev
          );
        });
      })
      .catch(() => {
        if (!cancelled) setCompassAvailable(false);
      });

    return () => {
      cancelled = true;
      if (subscription) subscription.remove();
    };
  }, []);

  // Kartan kamera: Heading-Up kaantaa kompassin mukaan, North-Up palauttaa pohjoiseen
  useEffect(() => {
    const heading = getCameraHeadingForMode(orientationMode, compassHeading);
    mapRef.current?.animateCamera({ heading }, { duration: 200 });
  }, [orientationMode, compassHeading]);

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
      dispatchEncryptedTelemetry(
        PacketType.POSITION,
        0x10,
        `AUTO-PASSI ${nearest.stand.id}`,
        simulatedCoords
      );
    }
  };

  // Laskee laitteelle tallennetut tiilet (tiles/{layer}/{z}/{x}/{y}.png)
  const countCachedTiles = (layerId: string): number => {
    try {
      const root = new Directory(Paths.document, TILE_CACHE_DIR_NAME, layerId);
      if (!root.exists) return 0;
      const walk = (dir: Directory): number =>
        dir
          .list()
          .reduce(
            (sum, entry) =>
              sum +
              (entry instanceof Directory ? walk(entry) : entry.name.endsWith('.png') ? 1 : 0),
            0
          );
      return walk(root);
    } catch {
      return 0;
    }
  };

  // Suurin ladattu zoom-taso levylta (tiles/{layer}/{z}) -> UrlTile maximumNativeZ
  const readCachedMaxZoom = (layerId: string): number | null => {
    try {
      const root = new Directory(Paths.document, TILE_CACHE_DIR_NAME, layerId);
      if (!root.exists) return null;
      return getMaxCachedZoomLevel(
        root
          .list()
          .filter((entry) => entry instanceof Directory)
          .map((entry) => entry.name)
      );
    } catch {
      return null;
    }
  };

  const refreshTileCacheInfo = (layerId: string) => {
    setStoredTileCount(countCachedTiles(layerId));
    setCachedMaxZoom(readCachedMaxZoom(layerId));
  };

  useEffect(() => {
    refreshTileCacheInfo(onlineTileConfig.id);
  }, [onlineTileConfig.id]);

  const handleDownloadOfflineTiles = async () => {
    if (isDownloadingTiles) return;
    const points = getAreaPoints(huntingArea); // kaikki palstat + passit
    if (points.length === 0) {
      setOfflineStatus('Ei jahtialuetta ladattavaksi');
      return;
    }

    const plan = planOfflineTileDownload(points);
    if (plan.tiles.length === 0) {
      setOfflineStatus('Alue liian suuri: yli 250 tiilt\u00E4 jo zoomilla 13');
      return;
    }

    setIsDownloadingTiles(true);
    setTileDownload(createTileDownloadState(plan.totalTiles));
    setOfflineStatus('');

    try {
      const result = await downloadTilesToCache(plan.tiles, {
        sourceUrlTemplate: onlineTileConfig.urlTemplate,
        rootUri: Paths.document.uri,
        layerId: onlineTileConfig.id,
        concurrency: 4,
        downloadTile: async (url, destinationUri) => {
          const target = new File(destinationUri);
          if (target.exists && target.size > 0) return; // jo valimuistissa
          target.parentDirectory.create({ intermediates: true, idempotent: true });
          await File.downloadFileAsync(url, target, {
            idempotent: true,
            headers: { 'User-Agent': 'HunterTrackerPOC/1.0 (offline tile cache)' },
          });
        },
        onProgress: setTileDownload,
      });

      const skipped = plan.skippedZoomLevels.length
        ? ` | z${plan.skippedZoomLevels.join(',')} ohitettu (raja 250)`
        : '';
      const failed = result.failed ? ` | ${result.failed} ep\u00E4onnistui` : '';
      setOfflineStatus(
        `Ladattu ${result.completed}/${result.total} (z${plan.zoomLevels.join(',')})${skipped}${failed}`
      );
    } catch {
      setOfflineStatus('Lataus keskeytyi virheeseen');
    } finally {
      setIsDownloadingTiles(false);
      refreshTileCacheInfo(onlineTileConfig.id);
    }
  };

  const changeMapLayer = (next: MapLayerChoice) => {
    mapLayerChangedByUserRef.current = true;
    if (next !== 'offline') lastOnlineMapLayerRef.current = next;
    setMapLayer(next);
    setShowTopoLayer(true);
    if (areaDocDir) saveMapLayerPreference(areaStorage, areaDocDir, next);
  };

  // Karttatasopainike: OpenTopoMap -> MML (vain avaimella) -> Offline -> ...
  const handleCycleMapLayer = () => {
    changeMapLayer(getNextMapLayer(mapLayer, process.env.EXPO_PUBLIC_MML_API_KEY));
  };

  const handleToggleOfflineCache = () => {
    changeMapLayer(offlineCacheEnabled ? lastOnlineMapLayerRef.current : 'offline');
  };

  // Kaynnistys: viimeksi valittu karttataso (oletus OpenTopoMap)
  useEffect(() => {
    let cancelled = false;
    if (!areaDocDir) return;
    loadMapLayerPreference(areaStorage, areaDocDir, process.env.EXPO_PUBLIC_MML_API_KEY).then(
      (layer) => {
        if (cancelled || mapLayerChangedByUserRef.current) return;
        if (layer !== 'offline') lastOnlineMapLayerRef.current = layer;
        setMapLayer(layer);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [areaStorage, areaDocDir]);

  // Vaihtaa jahtialueen: passit paivittyvat, ensimmainen passi valitaan, kamera keskittyy
  const applyHuntingArea = (area: HuntingArea, statusText: string) => {
    setHuntingArea(area);
    const firstStand = area.stands[0];
    setHunterState((prev) =>
      firstStand
        ? selectStand(prev, firstStand.id, firstStand.name)
        : createInitialHunterState(prev.hunterName)
    );
    setAreaImportStatus(statusText);
    const region = calculateAreaCenter(area);
    if (region) mapRef.current?.animateToRegion(region, 800);
  };

  const handleImportOmaRiista = async () => {
    if (isImportingArea) return;
    setIsImportingArea(true);
    try {
      // '*/*' mukana: Android ei tunnista .geojson-MIME-tyyppia luotettavasti -> paate tarkistetaan itse.
      // copyToCacheDirectory: Android kopioi tiedoston paikalliseen file://-valimuistiin.
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['application/json', 'application/geo+json', '*/*'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled || !picked.assets || picked.assets.length === 0) {
        setAreaImportStatus('Tuonti peruttu');
        return;
      }

      const asset = picked.assets[0];
      if (!isSupportedGeoJsonFileName(asset.name)) {
        setAreaImportStatus(`VIRHE: ${asset.name} ei ole .geojson- tai .json-tiedosto`);
        return;
      }

      // File.text() hylataan Androidin content://-osoitteilla -> legacy readAsStringAsync,
      // varalla fetch(). Lukija tukee seka file:// etta content:// -osoitteita.
      const read = await readImportFileText(asset.uri, {
        readAsString: (uri) =>
          FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.UTF8 }),
        fetchText: async (uri) => (await fetch(uri)).text(),
      });
      if (!read.ok) {
        setAreaImportStatus(`VIRHE: ${read.error}`);
        return;
      }

      const result = importOmaRiistaFromJsonString(read.text);
      if (!result.ok) {
        setAreaImportStatus(`VIRHE: ${result.error}`);
        return;
      }

      const warnings = result.warnings.length ? ` | ${result.warnings.join(' ')}` : '';
      applyHuntingArea(
        result.area,
        `Tuotu: ${asset.name} (${getAreaPolygons(result.area).length} palstaa, ${
          result.area.stands.length
        } passia)${warnings}`
      );

      // Tuotu alue tallentuu automaattisesti pysyvaan muistiin
      areaChangedByUserRef.current = true;
      const importRegion = calculateAreaCenter(result.area);
      lastPersistedRegionRef.current = importRegion;
      if (areaDocDir) {
        const saved = await saveLastUsedArea(areaStorage, areaDocDir, result.area, importRegion);
        if (!saved.ok) setAreaImportStatus((prev) => `${prev} | VIRHE: ${saved.error}`);
      }
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      setAreaImportStatus(`VIRHE: tiedoston luku ep\u00E4onnistui (${detail})`);
    } finally {
      setIsImportingArea(false);
    }
  };

  const handleRestoreTestArea = async () => {
    areaChangedByUserRef.current = true;
    lastPersistedRegionRef.current = null;
    const reset = areaDocDir
      ? await resetToDefaultArea(areaStorage, areaDocDir)
      : getDefaultPersistedArea();
    const message = 'Oletusalue palautettu (H\u00E4til\u00E4 - Mets\u00E4stysalue)';
    applyHuntingArea(reset.area, reset.error ? `${message} | VIRHE: ${reset.error}` : message);
  };

  // Kaynnistys: viimeksi kaytetty alue (tai Hatila) ja kartan aloitussijainti
  useEffect(() => {
    let cancelled = false;
    if (!areaDocDir) {
      setPersistedAreaLoaded(true);
      return;
    }
    loadLastUsedArea(areaStorage, areaDocDir).then((loaded) => {
      if (cancelled) return;
      // Ei ylikirjoiteta aluetta, jonka kayttaja ehti jo tuoda tai palauttaa
      if (!areaChangedByUserRef.current) {
        setHuntingArea(loaded.area);
        setStartRegion(loaded.region);
        lastPersistedRegionRef.current = loaded.source === 'saved' ? loaded.region : null;
        if (loaded.error) {
          setAreaImportStatus(
            `VIRHE: ${loaded.error} - k\u00E4ytet\u00E4\u00E4n oletusaluetta (H\u00E4til\u00E4)`
          );
        } else if (loaded.source === 'saved') {
          setAreaImportStatus(`Jatketaan viimeksi k\u00E4ytetylt\u00E4 alueelta: ${loaded.name}`);
        }
      }
      setPersistedAreaLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [areaStorage, areaDocDir]);

  // Kameran sijainti tallennetaan vain selvan siirron/zoomauksen jalkeen,
  // ja vasta kun kaynnistyslataus on valmis (muuten oletus ylikirjoittaisi tallennuksen)
  const handleMapRegionChangeComplete = (region: AreaRegion) => {
    if (!persistedAreaLoaded || !areaDocDir) return;
    if (!shouldPersistRegion(lastPersistedRegionRef.current, region)) return;
    lastPersistedRegionRef.current = region;
    saveLastUsedArea(areaStorage, areaDocDir, huntingArea, region);
  };

  const handleSendTrackDelta = () => {
    const base = userLocation || selectedStand || { latitude: 61.015, longitude: 24.535 };
    const sampleTrack: Coordinates[] = [
      base,
      { latitude: base.latitude + 0.0004, longitude: base.longitude + 0.0004 },
      { latitude: base.latitude + 0.0008, longitude: base.longitude + 0.0009 },
      { latitude: base.latitude + 0.0012, longitude: base.longitude + 0.0015 },
    ];
    const delta = compressTrackDelta(1, sampleTrack, 25);
    const route = routeOutgoingPacket(transportState, emconState, delta.binaryFrame);
    setLastTxLog(
      route.dispatched
        ? `TRACK_DELTA (${delta.points.length} pistettä, ${delta.binaryFrame.byteLength} B) -> ${route.bearerUsed}`
        : `TRACK_DELTA ESTETTY (${route.reason})`
    );
  };

  const handleToggleSearchSector = () => {
    const next = !showSarSector;
    setShowSarSector(next);
    if (next) {
      const sector = packSearchSector('Etsintälohko Alpha', SAMPLE_SAR_SECTOR_VERTICES);
      const route = routeOutgoingPacket(transportState, emconState, sector.binaryFrame);
      setLastTxLog(
        route.dispatched
          ? `SEARCH_SECTOR (${sector.vertices.length} kärkeä, ${sector.binaryFrame.byteLength} B) -> ${route.bearerUsed}`
          : `SEARCH_SECTOR ESTETTY (${route.reason})`
      );
    }
  };

  const handleTriggerSos = () => {
    const loc = userLocation || selectedStand || { latitude: 61.015, longitude: 24.535 };
    const sos = createPrioritySosAlert(1, loc);
    setSosLockedLocation(sos.location);
    dispatchEncryptedTelemetry(PacketType.SOS_ALERT, 0xff, 'SOS_ALERT (HÄTÄ)', loc);
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

  // Suljetaan USB-OTG-ajuri, kun sovellus sulkeutuu.
  useEffect(() => {
    return () => {
      loraDriverRef.current?.close();
      loraDriverRef.current = null;
    };
  }, []);

  const toggleUsbZeroRf = async () => {
    if (!transportState.usbSerialConnected) {
      const lora = await connectLoraSerial(
        NATIVE_USB_SERIAL_MODULE,
        NATIVE_USB_SERIAL_MODULE ? 'native' : 'simulation'
      );
      loraDriverRef.current = lora.driver;
      setLoraDriverLabel(lora.label);
      // Kaapelin irrotus kesken ajon -> palataan hallitusti 4G/LoRa Meshiin.
      lora.driver.onStatusChange((status) => {
        if (status !== 'DISCONNECTED' || loraDriverRef.current !== lora.driver) return;
        loraDriverRef.current = null;
        setLoraDriverLabel('');
        setTransportState((prev) => disconnectUsbSerial(prev));
        setLastTxLog('USB-C kaapeli irrotettu | Radion 2.4 GHz BLE palautettu');
      });
      const { state, adminCommand } = connectUsbSerial(transportState, 115200);
      setTransportState(state);
      setLastTxLog(
        `USB-C (115200 bps) kytketty [${lora.label}] | Lähetetty: ${adminCommand}`
      );
    } else {
      const driver = loraDriverRef.current;
      loraDriverRef.current = null;
      setLoraDriverLabel('');
      await driver?.close();
      const state = disconnectUsbSerial(transportState);
      setTransportState(state);
      setLastTxLog('USB-C irrotettu | Radion 2.4 GHz BLE palautettu');
    }
  };

  // Aloitusnakyma: viimeksi kaytetty alue, oletuksena Hatila (DEFAULT_START_REGION)
  const initialRegion = startRegion;

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

  const viewConeCoords = useMemo(() => {
    const origin = userLocation || selectedStand;
    if (!origin || compassHeading === null) return [];
    return generateViewConeCoordinates(origin, compassHeading);
  }, [userLocation, selectedStand, compassHeading]);

  // Safety interlock: osuuko katsesuuntakeila naapuripassin kieltokulmaan
  const headingSafety = useMemo<HeadingDangerResult>(() => {
    if (compassHeading === null || !selectedStand) return { isDanger: false };
    return checkHeadingDangerOverlap(compassHeading, dangerZones);
  }, [compassHeading, selectedStand, dangerZones]);

  // Varinahalytys vain siirtymassa turvallisesta vaaraan, cooldown 2 s
  useEffect(() => {
    const nowMs = Date.now();
    if (
      shouldTriggerHapticAlert({
        wasDanger: wasHeadingDangerRef.current,
        isDanger: headingSafety.isDanger,
        lastAlertAtMs: lastHapticAlertAtRef.current,
        nowMs,
      })
    ) {
      lastHapticAlertAtRef.current = nowMs;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    }
    wasHeadingDangerRef.current = headingSafety.isDanger;
  }, [headingSafety.isDanger]);

  // Silent Hunt Audio Interlock: merkkiaani Bluetooth-kuulosuojaimiin
  const [audioWarningEnabled, setAudioWarningEnabledState] = useState<boolean>(true);
  const [audioStatus, setAudioStatus] = useState<string>('\u00C4\u00E4nivaroitus: alustetaan...');
  const audioInterlockRef = useRef(createAudioInterlockState());
  const audioPlayersRef = useRef<Partial<Record<AudioWarningLevel, AudioPlayer>>>({});

  useEffect(() => {
    let cancelled = false;
    const created: AudioPlayer[] = [];
    (async () => {
      try {
        // Media-aani reitittyy kytkettyihin BT-kuulosuojaimiin; muut aanet vaimenevat hetkeksi
        await setAudioModeAsync({
          playsInSilentMode: true,
          interruptionMode: 'duckOthers',
          allowsRecording: false,
          shouldPlayInBackground: false,
          shouldRouteThroughEarpiece: false,
        });
        const dir = FileSystem.cacheDirectory;
        if (!dir) throw new Error('cacheDirectory puuttuu');
        for (const level of Object.values(AudioWarningLevel)) {
          // Merkkiaani generoidaan koodissa ja kirjoitetaan valimuistiin kerran
          const uri = `${dir}${buildToneFileName(level)}`;
          const info = await FileSystem.getInfoAsync(uri);
          if (!info.exists) {
            await FileSystem.writeAsStringAsync(
              uri,
              bytesToBase64(generateToneWav(AUDIO_WARNING_TONES[level])),
              { encoding: FileSystem.EncodingType.Base64 }
            );
          }
          if (cancelled) return;
          const player = createAudioPlayer({ uri });
          created.push(player);
          audioPlayersRef.current[level] = player;
        }
        if (!cancelled) setAudioStatus('\u00C4\u00E4nivaroitus valmis (BT-kuulosuojaimet / kaiutin)');
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        if (!cancelled) setAudioStatus(`VIRHE: \u00E4\u00E4nivaroitus ei k\u00E4ytett\u00E4viss\u00E4 (${detail})`);
      }
    })();
    return () => {
      cancelled = true;
      created.forEach((p) => p.remove());
      audioPlayersRef.current = {};
    };
  }, []);

  const playWarningTone = (level: AudioWarningLevel) => {
    const player = audioPlayersRef.current[level];
    if (!player) return;
    player
      .seekTo(0)
      .catch(() => {})
      .finally(() => player.play());
  };

  // Paatos heti tilan muuttuessa + 500 ms valein vaarassa (muistutus 10 s valein).
  // EMCON RX_ONLY ei esta: paikallinen turvatoiminto ilman RF-lahetysta.
  useEffect(() => {
    const evaluate = () => {
      const decision = shouldPlayAudioWarning(audioInterlockRef.current, {
        isDanger: headingSafety.isDanger,
        nowMs: Date.now(),
        radioMode: emconState.mode,
      });
      audioInterlockRef.current = decision.state;
      if (decision.play && decision.level) playWarningTone(decision.level);
    };
    evaluate();
    if (!headingSafety.isDanger || !audioWarningEnabled) return;
    const timer = setInterval(evaluate, 500);
    return () => clearInterval(timer);
  }, [headingSafety.isDanger, audioWarningEnabled, emconState.mode]);

  const handleToggleAudioWarning = () => {
    const next = !audioWarningEnabled;
    audioInterlockRef.current = setAudioWarningEnabled(audioInterlockRef.current, next);
    setAudioWarningEnabledState(next);
  };

  const handleSelectStand = (stand: Stand) => {
    setHunterState((prev) => selectStand(prev, stand.id, stand.name));
    dispatchEncryptedTelemetry(PacketType.POSITION, 0x11, `VALINTA ${stand.id}`);
  };

  const handleReady = () => {
    if (!txAllowed) return;
    setHunterState((prev) => setHunterReady(prev));
    dispatchEncryptedTelemetry(PacketType.POSITION, 0x12, 'VALMIS');
  };

  const handleShotFired = () => {
    if (!txAllowed) return;
    setHunterState((prev) => reportShotFired(prev));
    dispatchEncryptedTelemetry(PacketType.SHOT_ALERT, 0x20, 'LAUKAUS');
  };

  const handleOutcome = (outcome: 'HARVEST' | 'MISS' | 'WOUNDED') => {
    if (!txAllowed) return;
    setHunterState((prev) => resolveShotOutcome(prev, outcome));
    dispatchEncryptedTelemetry(PacketType.SHOT_ALERT, 0x21, `TULOS:${outcome}`);
  };

  const handleCancelShot = () => setHunterState((prev) => cancelShotReport(prev));

  // Koko näytön karttanäkymä (tiketti #60): alapaneelin pikavalinnat ja keskitys
  const handleQuickAction = (id: QuickActionId) => {
    if (id === 'SOS') {
      handleTriggerSos();
      return;
    }
    setOpenSheet((prev) => toggleSheet(prev, id));
  };

  const handleCenterOnUser = () => {
    if (!userLocation) return;
    mapRef.current?.animateToRegion(
      {
        latitude: userLocation.latitude,
        longitude: userLocation.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      },
      500
    );
  };

  const bottomPanel = getBottomPanelState(hunterState.status, txAllowed);
  const radioStatus = formatRadioStatus(
    transportState.activeBearer,
    emconState.mode,
    transportState.cellularAvailable
  );
  const headingStatus = formatHeadingStatus(headingSafety, compassAvailable, compassHeading);

  // Lisaa-paneeli (#61): Alue ja Radio vierittavat omaan osioonsa
  const morePanelScrollY = getMorePanelScrollOffset(
    moreSectionOffsets,
    getMorePanelFocusSection(openSheet)
  );
  const recordMoreSection = (id: MorePanelSectionId) => (e: LayoutChangeEvent) => {
    const y = e.nativeEvent.layout.y;
    setMoreSectionOffsets((prev) => (prev[id] === y ? prev : { ...prev, [id]: y }));
  };
  const handleSelectEmconMode = (mode: RadioTxMode) => {
    setEmconHint('');
    setEmconState((prev) => setRadioTxMode(prev, mode, true));
  };

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
      <View style={styles.screen}>
        {/* Kartta koko näytön taustana (tiketti #60) */}
        <View style={styles.mapFull}>
            <MapView
              key={persistedAreaLoaded ? 'map-start-loaded' : 'map-start-default'}
              ref={mapRef}
              style={styles.mapFullscreen}
              initialRegion={initialRegion}
              onRegionChangeComplete={handleMapRegionChangeComplete}
              mapType={showTopoLayer ? 'none' : 'standard'}
            >
              {showTopoLayer && (
                <UrlTile
                  key={tileConfig.isOffline ? 'tiles-offline' : 'tiles-online'}
                  urlTemplate={tileConfig.urlTemplate}
                  maximumZ={tileConfig.maximumZ}
                  maximumNativeZ={tileConfig.maximumNativeZ}
                  flipY={false}
                  zIndex={-1}
                />
              )}

              {/* Kaikki jahtialueen palstat (OmaRiista MultiPolygon) */}
              {areaPolygons.map((parcel, index) => (
                <Polygon
                  key={`parcel-${index}`}
                  coordinates={parcel.coordinates}
                  strokeColor={profileConfig.accentColor}
                  fillColor="rgba(76, 175, 80, 0.12)"
                  strokeWidth={2}
                />
              ))}

              {showSarSector && (
                <Polygon
                  coordinates={SAMPLE_SAR_SECTOR_VERTICES}
                  strokeColor="#FF9800"
                  fillColor="rgba(255, 152, 0, 0.25)"
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

              {viewConeCoords.length > 0 && (
                <Polygon
                  key={headingSafety.isDanger ? 'view-cone-danger' : 'view-cone-safe'}
                  coordinates={viewConeCoords}
                  strokeColor={headingSafety.isDanger ? '#D50000' : '#29B6F6'}
                  fillColor={
                    headingSafety.isDanger
                      ? 'rgba(213, 0, 0, 0.65)'
                      : 'rgba(41, 182, 246, 0.35)'
                  }
                  strokeWidth={headingSafety.isDanger ? 2 : 1}
                  zIndex={5}
                />
              )}

              {sosLockedLocation && (
                <Marker
                  coordinate={sosLockedLocation}
                  title="SOS HÄTÄPAIKKA"
                  pinColor="red"
                />
              )}
            </MapView>
        </View>

        <View style={styles.overlay} pointerEvents="box-none">
          <MapStatusBar
            profileId={profileConfig.id}
            accentColor={profileConfig.accentColor}
            areaSummary={formatAreaSummary(huntingArea.boundary?.name, areaPolygons.length)}
            gpsStatus={gpsStatus}
            gpsAccuracyText={formatGpsAccuracy(gpsAccuracy)}
            coordinateSystem={profileConfig.coordinateSystem}
            coordinatesText={formattedUserCoords}
            radioLabel={radioStatus.label}
            radioLevel={radioStatus.level}
          />

          {/* Suuntavaroitus aina yläpalkin alla, kaikkien paneelien päällä */}
          {shouldShowHeadingWarning(headingSafety.isDanger, openSheet) && (
              <View style={styles.headingWarningBar} pointerEvents="none">
                <Text style={styles.fovWarningText}>
                  {`VAROITUS: T\u00C4HT\u00C4YSSUUNTA KOHTI PASSIA ${
                    headingSafety.conflictingStandName ?? ''
                  }`}
                </Text>
                <Text style={styles.fovWarningSub}>
                  {`Poikkeama naapurin suunnasta ${Math.round(
                    headingSafety.angleDelta ?? 0
                  )}\u00B0`}
                </Text>
              </View>
          )}

            {zeroizeState.wiped && (
              <View style={styles.wipedBanner}>
                <Text style={styles.wipedBannerTitle}>
                  [ZEROIZED] KAIKKI AVAIMET JA PAIKALLINEN DATA TYHJENNETTY
                </Text>
                <Text style={styles.wipedBannerSub}>
                  Lähetetty radiolle: {zeroizeState.loraRadioCommand}
                </Text>
              </View>
            )}

          <View style={styles.mapSpacer} pointerEvents="box-none">
            <MapFabColumn
              accentColor={profileConfig.accentColor}
              headingUp={orientationMode === MapOrientationMode.HEADING_UP}
              headingText={
                compassAvailable === false
                  ? 'N/A'
                  : compassHeading !== null
                  ? `${Math.round(compassHeading)}\u00B0`
                  : '---'
              }
              onToggleOrientation={() => setOrientationMode((prev) => toggleMapOrientationMode(prev))}
              layerLabel={showTopoLayer ? tileConfig.label : 'Perus'}
              onCycleLayer={handleCycleMapLayer}
              onCenter={handleCenterOnUser}
              centerEnabled={userLocation !== null}
            />
            {showTopoLayer && mapAttribution ? (
              <View style={styles.mapAttribution} pointerEvents="none">
                <Text style={styles.mapAttributionText}>{mapAttribution}</Text>
              </View>
            ) : null}
          </View>

          {openSheet !== null && (
            <OverlaySheet
              title="LISÄÄ"
              accentColor={profileConfig.accentColor}
              onClose={() => setOpenSheet(null)}
              scrollKey={openSheet}
              scrollToY={morePanelScrollY}
            >
              {/* Lisaa-paneeli (#61): alue, karttataso, radio, profiili, hatatyhjennys; testaus lopussa */}
              <View onLayout={recordMoreSection('AREA')}>
                {/* Jahtialueen hallinta: OmaRiista GeoJSON -tuonti */}
                <View style={styles.section}>
                  <Text style={[styles.sectionTitle, { color: profileConfig.accentColor }]}>
                    JAHTIALUE: {huntingArea.boundary?.name || 'Ei aluerajaa'} (
                    {huntingArea.stands.length} passia)
                  </Text>
                  <View style={styles.areaButtonsRow}>
                    <TouchableOpacity
                      style={[styles.areaImportButton, isImportingArea && styles.offlineButtonBusy]}
                      onPress={handleImportOmaRiista}
                      disabled={isImportingArea}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.offlineButtonText}>
                        {isImportingArea ? 'Luetaan tiedostoa...' : 'Tuo GeoJSON-tiedosto'}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.offlineToggleButton}
                      onPress={handleRestoreTestArea}
                      disabled={isImportingArea}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.offlineButtonText}>
                        {'Palauta oletusalue (H\u00E4til\u00E4)'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  {areaImportStatus.length > 0 && (
                    <Text
                      style={[
                        styles.offlineStatusText,
                        areaImportStatus.startsWith('VIRHE') && styles.areaImportError,
                      ]}
                    >
                      {areaImportStatus}
                    </Text>
                  )}
                </View>

                <View style={styles.section}>
                  <Text style={[styles.sectionTitle, { color: profileConfig.accentColor }]}>
                    VALITSE {profileConfig.nodeLabel.toUpperCase()}
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
              </View>

                <View style={styles.section} onLayout={recordMoreSection('MAP_LAYER')}>
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

                  {/* Karttataso (#61): OpenTopoMap / MML Maasto / Offline */}
                  <SegmentedControl
                    options={getMapLayerSegments(mapLayer, process.env.EXPO_PUBLIC_MML_API_KEY).map(
                      (seg) => ({
                        value: seg.id,
                        label: seg.label,
                        selected: seg.id === mapLayer,
                        enabled: seg.enabled,
                      })
                    )}
                    onSelect={(layer) => changeMapLayer(layer)}
                  />

                  {/* Offline-karttavalimuisti */}
                  <View style={styles.offlineRow}>
                    <TouchableOpacity
                      style={[
                        styles.offlineDownloadButton,
                        isDownloadingTiles && styles.offlineButtonBusy,
                      ]}
                      onPress={handleDownloadOfflineTiles}
                      disabled={isDownloadingTiles}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.offlineButtonText}>
                        {isDownloadingTiles && tileDownload
                          ? `Ladataan... ${getDownloadProgressPercent(tileDownload)} % (${
                              tileDownload.completed + tileDownload.failed
                            }/${tileDownload.total})`
                          : 'Lataa jahtialue offline-k\u00E4ytt\u00F6\u00F6n'}
                      </Text>
                    </TouchableOpacity>

                  </View>
                  <Text style={styles.offlineStatusText}>
                    {`Tallennettu: ${storedTileCount} tiilt\u00E4 (${onlineTileConfig.id})`}
                    {offlineStatus ? ` | ${offlineStatus}` : ''}
                    {offlineCacheEnabled && storedTileCount === 0
                      ? ' | Ei tallennettuja tiili\u00E4 - lataa ensin'
                      : ''}
                  </Text>
                </View>

              <View style={styles.section} onLayout={recordMoreSection('RADIO')}>
                <Text style={[styles.sectionTitle, { color: profileConfig.accentColor }]}>
                  {`RADIO JA RADIOKURI \u00B7 ${radioStatus.label}`}
                </Text>
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

                  <SegmentedControl
                    options={getEmconSegments(emconState.mode).map((seg) => ({
                      value: seg.mode,
                      label: seg.label,
                      selected: seg.selected,
                      longPressMs: seg.requiresLongPress ? EMCON_UNLOCK_LONG_PRESS_MS : undefined,
                    }))}
                    onSelect={handleSelectEmconMode}
                    onLongPressRequired={() =>
                      setEmconHint('Pid\u00E4 painettuna 2 s palauttaaksesi l\u00E4hetyksen')
                    }
                  />
                  {emconState.mode === RadioTxMode.RX_ONLY && (
                    <Text style={styles.emconSub}>
                      {emconHint || 'Paluu l\u00E4hetykseen: pid\u00E4 NORMAL tai BURST painettuna 2 s'}
                    </Text>
                  )}
                </View>
                {/* Hybridi & Zero-RF Siirtokerroksen + E2EE/CoT ohjaus */}
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
                        : 'E2EE: ACTIVE'}
                    </Text>
                  </View>

                  <Text style={styles.txLogText}>{lastTxLog}</Text>
                  {transportState.usbSerialConnected && loraDriverLabel.length > 0 && (
                    <Text style={styles.txLogText}>LoRa-radio: {loraDriverLabel}</Text>
                  )}
                  {lastCotPreview.length > 0 && (
                    <Text style={styles.cotLogText}>{lastCotPreview}</Text>
                  )}

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

              </View>

              <View style={styles.section} onLayout={recordMoreSection('PROFILE')}>
                <Text style={[styles.sectionTitle, { color: profileConfig.accentColor }]}>PROFIILI</Text>
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

              </View>

              <View onLayout={recordMoreSection('ZEROIZE')}>
                {/* Kaksivaiheinen Zeroize-hätätyhjennys */}
                <View style={styles.zeroizeCard}>
                  <Text style={styles.zeroizeHeader}>
                    HÄTÄTYHJENNYS (ZEROIZE — KAKSIVAIHEINEN SUOJA)
                  </Text>
                  <Text style={styles.zeroizeDesc}>
                    Avaimia muistissa: {zeroizeState.wiped ? '0 (TYHJENNETTY)' : 'AKTIIVINEN'}
                  </Text>

                  <TouchableOpacity
                    style={[
                      styles.coverButton,
                      zeroizeState.coverOpen && styles.coverButtonOpen,
                    ]}
                    onPress={() =>
                      setZeroizeState((prev) =>
                        setZeroizeCoverOpen(prev, !prev.coverOpen)
                      )
                    }
                    disabled={zeroizeState.wiped}
                  >
                    <Text style={styles.coverButtonText}>
                      {zeroizeState.coverOpen
                        ? 'VAIHE 1: SUOJAKANSI AUKI (Napauta sulkeaksesi)'
                        : 'VAIHE 1: AVAA SUOJAKANSI'}
                    </Text>
                  </TouchableOpacity>

                  {zeroizeState.coverOpen && !zeroizeState.wiped && (
                    <TouchableOpacity
                      style={styles.slideZeroizeButton}
                      delayLongPress={1500}
                      onLongPress={() =>
                        setZeroizeState((prev) => attemptSlideToZeroize(prev, 95))
                      }
                    >
                      <Text style={styles.slideZeroizeText}>
                        VAIHE 2: PIDÄ POHJASSA (&gt;85% LIUKU) — ZEROIZE NYT
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>

                {selectedStand && (
                  <View style={styles.section}>
                    <Text style={[styles.sectionTitle, { color: profileConfig.accentColor }]}>
                      SEKTORITURVALLISUUS
                    </Text>
                    <View style={styles.areaButtonsRow}>
                      <TouchableOpacity
                        style={[
                          styles.offlineToggleButton,
                          audioWarningEnabled && {
                            backgroundColor: '#1B5E20',
                            borderColor: profileConfig.accentColor,
                          },
                        ]}
                        onPress={handleToggleAudioWarning}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.offlineButtonText}>
                          {audioWarningEnabled
                            ? 'Kuulosuojainten \u00E4\u00E4nivaroitus: P\u00C4\u00C4LL\u00C4'
                            : 'Kuulosuojainten \u00E4\u00E4nivaroitus: POIS'}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.offlineDownloadButton}
                        onPress={() => playWarningTone(AudioWarningLevel.DANGER_SECTOR_ENTER)}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.offlineButtonText}>{'Testaa merkki\u00E4\u00E4ni'}</Text>
                      </TouchableOpacity>
                    </View>
                    <Text style={styles.offlineStatusText}>{audioStatus}</Text>
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

                {/* SAR & Taktiset kenttätoiminnot */}
                <View style={styles.section}>
                  <Text style={[styles.sectionTitle, { color: profileConfig.accentColor }]}>
                    SAR & TAKTISET TIETORAKENTEET
                  </Text>
                  <View style={styles.sarButtonsRow}>
                    <TouchableOpacity
                      style={styles.sarBtn}
                      onPress={handleSendTrackDelta}
                      disabled={!txAllowed}
                    >
                      <Text style={styles.sarBtnText}>Jaa TRACK_DELTA</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.sarBtn}
                      onPress={handleToggleSearchSector}
                      disabled={!txAllowed}
                    >
                      <Text style={styles.sarBtnText}>
                        {showSarSector ? 'Piilota Etsintälohko' : 'SEARCH_SECTOR (6p)'}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  <TouchableOpacity
                    style={[styles.sosButton, !txAllowed && styles.disabledButton]}
                    onPress={handleTriggerSos}
                    disabled={!txAllowed}
                  >
                    <Text style={styles.sosButtonText}>
                      [SOS_ALERT — PRIORISOITU HÄTÄILMOITUS]
                    </Text>
                  </TouchableOpacity>
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

            </OverlaySheet>
          )}

          <BottomActionPanel
            accentColor={profileConfig.accentColor}
            statusText={hunterState.status}
            standText={
              hunterState.standName
                ? `${profileConfig.nodeLabel}: ${hunterState.standName}${
                    distanceToCurrentStand !== null ? ` (${distanceToCurrentStand} m)` : ''
                  }`
                : `Ei ${profileConfig.nodeLabel.toLowerCase()}a`
            }
            headingLabel={headingStatus.label}
            headingLevel={headingStatus.level}
            lastShotText={lastShotLabel}
            panel={bottomPanel}
            readyLabel={profileConfig.readyActionLabel}
            shotLabel={profileConfig.alertActionLabel}
            onReady={handleReady}
            onShot={handleShotFired}
            onOutcome={handleOutcome}
            onCancelShot={handleCancelShot}
            openSheet={openSheet}
            sosEnabled={txAllowed}
            onQuickAction={handleQuickAction}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  mapFull: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: MAP_SCREEN_LAYERS.map,
  },
  mapFullscreen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'column',
  },
  mapSpacer: {
    flex: 1,
  },
  headingWarningBar: {
    marginHorizontal: 8,
    marginTop: 6,
    backgroundColor: 'rgba(213, 0, 0, 0.92)',
    borderColor: '#FFFFFF',
    borderWidth: 2,
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    alignItems: 'center',
    zIndex: MAP_SCREEN_LAYERS.headingWarning,
    elevation: MAP_SCREEN_LAYERS.headingWarning,
  },
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
  wipedBanner: {
    backgroundColor: '#B71C1C',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: '#FFCDD2',
  },
  wipedBannerTitle: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 13,
  },
  wipedBannerSub: {
    color: '#FFEBEE',
    fontSize: 11,
    fontFamily: 'monospace',
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
    marginBottom: 4,
  },
  cotLogText: {
    color: '#80DEEA',
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
  areaButtonsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 6,
  },
  areaImportButton: {
    flex: 1,
    backgroundColor: '#2E7D32',
    paddingVertical: 11,
    paddingHorizontal: 6,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  areaImportError: {
    color: '#FF8A80',
    fontWeight: 'bold',
  },
  offlineRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 6,
  },
  offlineDownloadButton: {
    flex: 1,
    backgroundColor: '#1565C0',
    paddingVertical: 9,
    paddingHorizontal: 6,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  offlineButtonBusy: {
    backgroundColor: '#37474F',
  },
  offlineToggleButton: {
    flex: 1,
    backgroundColor: '#1E2E1E',
    paddingVertical: 9,
    paddingHorizontal: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#4F5F4F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  offlineButtonText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  offlineStatusText: {
    color: '#B0C4B0',
    fontSize: 11,
    fontFamily: 'monospace',
    marginBottom: 8,
  },
  fovWarningBar: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 8,
    backgroundColor: 'rgba(213, 0, 0, 0.92)',
    borderColor: '#FFFFFF',
    borderWidth: 2,
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    alignItems: 'center',
    pointerEvents: 'none',
  },
  fovWarningText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  fovWarningSub: {
    color: '#FFEBEE',
    fontSize: 11,
    marginTop: 2,
  },
  mapWrapper: {
    position: 'relative',
  },
  mapAttribution: {
    position: 'absolute',
    left: 4,
    bottom: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.75)',
    paddingVertical: 1,
    paddingHorizontal: 4,
    borderRadius: 3,
  },
  mapAttributionText: {
    color: '#222222',
    fontSize: 9,
  },
  orientationToggle: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(10, 14, 10, 0.85)',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#4F5F4F',
    alignItems: 'center',
  },
  orientationToggleText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: 'bold',
  },
  orientationHeadingText: {
    color: '#81D4FA',
    fontSize: 11,
    fontFamily: 'monospace',
    marginTop: 2,
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
  sarButtonsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  sarBtn: {
    flex: 1,
    backgroundColor: '#E65100',
    paddingVertical: 11,
    borderRadius: 6,
    alignItems: 'center',
  },
  sarBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  sosButton: {
    backgroundColor: '#D50000',
    paddingVertical: 14,
    borderRadius: 6,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#FF8A80',
  },
  sosButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: 'bold',
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
  zeroizeCard: {
    backgroundColor: '#1D0A0A',
    borderRadius: 8,
    padding: 14,
    borderWidth: 1,
    borderColor: '#B71C1C',
  },
  zeroizeHeader: {
    color: '#FF8A80',
    fontSize: 13,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  zeroizeDesc: {
    color: '#FFCDD2',
    fontSize: 12,
    marginBottom: 10,
  },
  coverButton: {
    backgroundColor: '#4E342E',
    paddingVertical: 12,
    borderRadius: 6,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#FFAB91',
  },
  coverButtonOpen: {
    backgroundColor: '#BF360C',
  },
  coverButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  slideZeroizeButton: {
    marginTop: 10,
    backgroundColor: '#D50000',
    paddingVertical: 16,
    borderRadius: 6,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  slideZeroizeText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: 'bold',
  },
});
