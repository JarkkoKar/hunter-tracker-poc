import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MAP_SCREEN_LAYERS } from '../utils/mapScreenLayout';

export interface MapFabColumnProps {
  accentColor: string;
  headingUp: boolean;
  headingText: string;
  onToggleOrientation: () => void;
  layerLabel: string;
  onCycleLayer: () => void;
  onCenter: () => void;
  centerEnabled: boolean;
}

/** Kartan oikean reunan kelluvat painikkeet (tiketti #60). */
export function MapFabColumn(props: MapFabColumnProps) {
  return (
    <View style={styles.column} pointerEvents="box-none">
      <TouchableOpacity
        style={[styles.fab, props.headingUp && { borderColor: props.accentColor }]}
        onPress={props.onToggleOrientation}
        activeOpacity={0.7}
        accessibilityLabel="Kartan suunta"
      >
        <Text style={styles.fabTitle}>{props.headingUp ? 'HEAD' : 'N↑'}</Text>
        <Text style={styles.fabSub}>{props.headingText}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.fab}
        onPress={props.onCycleLayer}
        activeOpacity={0.7}
        accessibilityLabel="Vaihda karttataso"
      >
        <Text style={styles.fabTitle}>TASO</Text>
        <Text style={styles.fabSub} numberOfLines={1}>
          {props.layerLabel}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.fab, !props.centerEnabled && styles.fabDisabled]}
        onPress={props.onCenter}
        disabled={!props.centerEnabled}
        activeOpacity={0.7}
        accessibilityLabel="Keskitä omaan sijaintiin"
      >
        <Text style={styles.fabTitle}>{'◎'}</Text>
        <Text style={styles.fabSub}>OMA</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  column: {
    position: 'absolute',
    right: 10,
    top: 10,
    alignItems: 'flex-end',
    zIndex: MAP_SCREEN_LAYERS.fab,
    elevation: MAP_SCREEN_LAYERS.fab,
  },
  fab: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: 'rgba(10, 14, 10, 0.85)',
    borderWidth: 2,
    borderColor: '#37474F',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  fabDisabled: {
    opacity: 0.4,
  },
  fabTitle: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 13,
  },
  fabSub: {
    color: '#B0C4B0',
    fontSize: 9,
    maxWidth: 52,
  },
});
