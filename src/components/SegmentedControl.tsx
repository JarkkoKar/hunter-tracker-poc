import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  selected: boolean;
  enabled?: boolean;
  /** Jos annettu (ms), valinta tehdään vain pitkällä painalluksella. */
  longPressMs?: number;
}

export interface SegmentedControlProps<T extends string> {
  options: SegmentOption<T>[];
  onSelect: (value: T) => void;
  /** Lyhyt painallus segmenttiin, joka vaatii pitkän painalluksen. */
  onLongPressRequired?: (value: T) => void;
}

/**
 * Kolmiosainen valitsin (tiketti #61): karttataso ja EMCON-radiokuri.
 * Painikkeet vähintään 44 px korkeita.
 */
export function SegmentedControl<T extends string>(props: SegmentedControlProps<T>) {
  return (
    <View style={styles.row}>
      {props.options.map((opt) => {
        const enabled = opt.enabled !== false;
        const needsLong = opt.longPressMs !== undefined;
        return (
          <TouchableOpacity
            key={opt.value}
            style={[styles.segment, opt.selected && styles.segmentSelected, !enabled && styles.segmentDisabled]}
            disabled={!enabled}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityState={{ selected: opt.selected, disabled: !enabled }}
            delayLongPress={needsLong ? opt.longPressMs : undefined}
            onPress={() => {
              if (opt.selected) return;
              if (needsLong) props.onLongPressRequired?.(opt.value);
              else props.onSelect(opt.value);
            }}
            onLongPress={needsLong ? () => props.onSelect(opt.value) : undefined}
          >
            <Text
              style={[styles.label, opt.selected && styles.labelSelected, !enabled && styles.labelDisabled]}
              numberOfLines={1}
            >
              {opt.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    backgroundColor: '#151D15',
    borderWidth: 1,
    borderColor: '#263226',
    borderRadius: 12,
    padding: 4,
    gap: 6,
  },
  segment: {
    flex: 1,
    minHeight: 44,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  segmentSelected: {
    backgroundColor: '#F2F5EF',
  },
  segmentDisabled: {
    opacity: 0.4,
  },
  label: {
    color: '#C3CCBF',
    fontSize: 13,
    fontWeight: '600',
  },
  labelSelected: {
    color: '#0A0E0A',
    fontWeight: '800',
  },
  labelDisabled: {
    color: '#8F9C8F',
  },
});
