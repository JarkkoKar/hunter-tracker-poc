import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MAP_SCREEN_LAYERS, StatusLevel } from '../utils/mapScreenLayout';

export interface MapStatusBarProps {
  profileId: string;
  accentColor: string;
  areaSummary: string;
  gpsStatus: string;
  gpsAccuracyText: string;
  coordinateSystem: string;
  coordinatesText: string;
  radioLabel: string;
  radioLevel: StatusLevel;
}

const LEVEL_COLORS: Record<StatusLevel, string> = {
  ok: '#81C784',
  warn: '#FFB74D',
  silent: '#90A4AE',
  danger: '#FF5252',
};

/** Koko näytön kartan yläpalkki (tiketti #60). */
export function MapStatusBar(props: MapStatusBarProps) {
  return (
    <View style={styles.bar}>
      <View style={styles.row}>
        <View style={[styles.profileChip, { backgroundColor: props.accentColor }]}>
          <Text style={styles.profileChipText}>{props.profileId}</Text>
        </View>
        <Text style={styles.areaText} numberOfLines={1}>
          {props.areaSummary}
        </Text>
        <Text style={[styles.radioText, { color: LEVEL_COLORS[props.radioLevel] }]}>
          {props.radioLabel}
        </Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.gpsText} numberOfLines={1}>
          {`${props.gpsStatus} ${props.gpsAccuracyText}`}
        </Text>
        <Text style={styles.coordText} numberOfLines={1}>
          {`[${props.coordinateSystem}] ${props.coordinatesText}`}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: 'rgba(10, 14, 10, 0.88)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#1F291F',
    zIndex: MAP_SCREEN_LAYERS.statusBar,
    elevation: MAP_SCREEN_LAYERS.statusBar,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 2,
  },
  profileChip: {
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginRight: 8,
  },
  profileChipText: {
    color: '#0A0E0A',
    fontWeight: 'bold',
    fontSize: 12,
  },
  areaText: {
    flex: 1,
    color: '#E8F5E9',
    fontSize: 13,
    fontWeight: '600',
  },
  radioText: {
    fontSize: 12,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  gpsText: {
    color: '#B0C4B0',
    fontSize: 12,
    marginRight: 8,
  },
  coordText: {
    flex: 1,
    color: '#FFF59D',
    fontSize: 12,
    fontFamily: 'monospace',
    textAlign: 'right',
  },
});
