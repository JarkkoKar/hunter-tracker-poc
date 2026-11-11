import React, { useState, useMemo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  StatusBar,
} from 'react-native';
import { parseOmaRiistaGeoJSON, Stand } from './src/utils/omariistaParser';
import { calculateDangerZones } from './src/utils/safetySector';
import {
  createInitialHunterState,
  selectStand,
  setHunterReady,
  reportShotFired,
  resolveShotOutcome,
  cancelShotReport,
} from './src/utils/huntingState';

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
  const [hunterState, setHunterState] = useState(() =>
    createInitialHunterState('Passimies 1')
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

  const handleSelectStand = (stand: Stand) => {
    setHunterState((prev) => selectStand(prev, stand.id, stand.name));
  };

  const handleReady = () => {
    setHunterState((prev) => setHunterReady(prev));
  };

  const handleShotFired = () => {
    setHunterState((prev) => reportShotFired(prev));
  };

  const handleOutcome = (outcome: 'HARVEST' | 'MISS' | 'WOUNDED') => {
    setHunterState((prev) => resolveShotOutcome(prev, outcome));
  };

  const handleCancelShot = () => {
    setHunterState((prev) => cancelShotReport(prev));
  };

  const lastShotLabel = hunterState.lastShot
    ? `Viimeisin laukaus: ${hunterState.lastShot.outcome} (${new Date(
        hunterState.lastShot.timestamp
      ).toLocaleTimeString()})`
    : '';

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Text style={styles.appName}>HunterTracker POC</Text>
          <Text style={styles.subTitle}>
            {huntingArea.boundary?.name || 'Jahtialue'}
          </Text>
        </View>

        <View
          style={[
            styles.statusCard,
            hunterState.status === 'READY' && styles.statusReady,
            hunterState.status === 'SHOT_FIRED' && styles.statusShot,
            hunterState.status === 'HARVEST' && styles.statusHarvest,
            hunterState.status === 'WOUNDED' && styles.statusWounded,
          ]}
        >
          <Text style={styles.statusLabel}>TILANNE:</Text>
          <Text style={styles.statusValue}>[{hunterState.status}]</Text>
          {hunterState.standName && (
            <Text style={styles.statusStand}>Passi: {hunterState.standName}</Text>
          )}
          {hunterState.lastShot && (
            <Text style={styles.lastShotText}>{lastShotLabel}</Text>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>1. VALITSE OMA PASSI</Text>
          <View style={styles.standGrid}>
            {huntingArea.stands.map((stand) => {
              const isSelected = stand.id === hunterState.currentStandId;
              return (
                <TouchableOpacity
                  key={stand.id}
                  style={[styles.standButton, isSelected && styles.standButtonActive]}
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
            <Text style={styles.sectionTitle}>2. AMPUMATURVALLISUUS</Text>
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
          <Text style={styles.sectionTitle}>3. TILANNEKUYITTAUS</Text>

          {hunterState.status === 'IN_STAND' && (
            <TouchableOpacity
              style={[styles.bigButton, styles.readyButton]}
              onPress={handleReady}
              activeOpacity={0.7}
            >
              <Text style={styles.bigButtonText}>[VALMIS PASSIIN]</Text>
            </TouchableOpacity>
          )}

          {hunterState.status === 'READY' && (
            <TouchableOpacity
              style={[styles.bigButton, styles.shotButton]}
              onPress={handleShotFired}
              activeOpacity={0.7}
            >
              <Text style={styles.bigButtonText}>[LAUKAUS AMMUTTU]</Text>
            </TouchableOpacity>
          )}

          {hunterState.status === 'SHOT_FIRED' && (
            <View style={styles.outcomeContainer}>
              <TouchableOpacity
                style={[styles.bigButton, styles.harvestButton]}
                onPress={() => handleOutcome('HARVEST')}
                activeOpacity={0.7}
              >
                <Text style={styles.bigButtonText}>[KAATO]</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.bigButton, styles.missButton]}
                onPress={() => handleOutcome('MISS')}
                activeOpacity={0.7}
              >
                <Text style={styles.bigButtonText}>[OHI]</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.bigButton, styles.woundedButton]}
                onPress={() => handleOutcome('WOUNDED')}
                activeOpacity={0.7}
              >
                <Text style={styles.bigButtonText}>[HAAVAKKO]</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.cancelButton}
                onPress={handleCancelShot}
                activeOpacity={0.7}
              >
                <Text style={styles.cancelButtonText}>Peruuta laukausilmoitus</Text>
              </TouchableOpacity>
            </View>
          )}

          {(hunterState.status === 'HARVEST' ||
            hunterState.status === 'WOUNDED') && (
            <TouchableOpacity
              style={[styles.bigButton, styles.readyButton, { marginTop: 12 }]}
              onPress={handleReady}
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
    marginBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1F291F',
    paddingBottom: 8,
  },
  appName: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#E0EAE0',
    letterSpacing: 0.5,
  },
  subTitle: {
    fontSize: 14,
    color: '#81C784',
    marginTop: 2,
  },
  statusCard: {
    backgroundColor: '#161E16',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
    borderLeftWidth: 6,
    borderLeftColor: '#757575',
  },
  statusReady: {
    borderLeftColor: '#4CAF50',
    backgroundColor: '#102412',
  },
  statusShot: {
    borderLeftColor: '#FF9800',
    backgroundColor: '#2D1F08',
  },
  statusHarvest: {
    borderLeftColor: '#2E7D32',
    backgroundColor: '#0F2612',
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
    color: '#81C784',
    marginBottom: 12,
    letterSpacing: 0.5,
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
  standButtonActive: {
    backgroundColor: '#2E7D32',
    borderColor: '#81C784',
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
  bigButtonText: {
    color: '#FFFFFF',
    fontSize: 19,
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