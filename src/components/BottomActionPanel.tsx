import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
  BottomPanelState,
  MAP_SCREEN_LAYERS,
  MapSheetId,
  PRIMARY_BUTTON_MIN_HEIGHT,
  StatusLevel,
} from '../utils/mapScreenLayout';

export type ShotOutcomeChoice = 'HARVEST' | 'MISS' | 'WOUNDED';
export type QuickActionId = MapSheetId | 'SOS';

export interface BottomActionPanelProps {
  accentColor: string;
  statusText: string;
  standText: string;
  headingLabel: string;
  headingLevel: StatusLevel;
  lastShotText: string;
  panel: BottomPanelState;
  readyLabel: string;
  shotLabel: string;
  onReady: () => void;
  onShot: () => void;
  onOutcome: (outcome: ShotOutcomeChoice) => void;
  onCancelShot: () => void;
  openSheet: MapSheetId | null;
  sosEnabled: boolean;
  onQuickAction: (id: QuickActionId) => void;
}

const HEADING_COLORS: Record<StatusLevel, string> = {
  ok: '#81C784',
  warn: '#FFB74D',
  silent: '#90A4AE',
  danger: '#FF5252',
};

const QUICK_ACTIONS: { id: QuickActionId; label: string }[] = [
  { id: 'AREA', label: 'Alue' },
  { id: 'RADIO', label: 'Radio' },
  { id: 'SOS', label: 'SOS' },
  { id: 'MORE', label: 'Lisää' },
];

/** Koko näytön kartan alapaneeli: tilanne, VALMIS / LAUKAUS ja pikavalinnat (tiketti #60). */
export function BottomActionPanel(props: BottomActionPanelProps) {
  const { panel } = props;
  return (
    <View style={styles.panel}>
      <View style={styles.statusRow}>
        <Text style={[styles.statusText, { color: props.accentColor }]}>
          {`[${props.statusText}]`}
        </Text>
        <Text style={styles.standText} numberOfLines={1}>
          {props.standText}
        </Text>
        <Text style={[styles.headingText, { color: HEADING_COLORS[props.headingLevel] }]}>
          {props.headingLabel}
        </Text>
      </View>
      {props.lastShotText.length > 0 && (
        <Text style={styles.subText}>{props.lastShotText}</Text>
      )}
      {panel.hint.length > 0 && <Text style={styles.hintText}>{panel.hint}</Text>}

      {panel.showOutcomeChoices ? (
        <View>
          <View style={styles.primaryRow}>
            <OutcomeButton
              label="KAATO / OK"
              color="#2E7D32"
              enabled={panel.outcomeEnabled}
              onPress={() => props.onOutcome('HARVEST')}
            />
            <OutcomeButton
              label="OHI / EI HAVAINTOA"
              color="#455A64"
              enabled={panel.outcomeEnabled}
              onPress={() => props.onOutcome('MISS')}
            />
            <OutcomeButton
              label={'HAAVAKKO / HÄTÄ'}
              color="#C62828"
              enabled={panel.outcomeEnabled}
              onPress={() => props.onOutcome('WOUNDED')}
            />
          </View>
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={props.onCancelShot}
            disabled={!panel.cancelEnabled}
            activeOpacity={0.7}
          >
            <Text style={styles.cancelText}>Peruuta ilmoitus</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.primaryRow}>
          <TouchableOpacity
            style={[
              styles.primaryButton,
              { backgroundColor: '#2E7D32' },
              !panel.readyEnabled && styles.disabled,
            ]}
            onPress={props.onReady}
            disabled={!panel.readyEnabled}
            activeOpacity={0.7}
          >
            <Text style={styles.primaryText}>
              {panel.readyIsReturn ? 'PALAA VALMIUTEEN' : props.readyLabel}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.primaryButton,
              { backgroundColor: '#E65100' },
              !panel.shotEnabled && styles.disabled,
            ]}
            onPress={props.onShot}
            disabled={!panel.shotEnabled}
            activeOpacity={0.7}
          >
            <Text style={styles.primaryText}>{props.shotLabel}</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.quickRow}>
        {QUICK_ACTIONS.map((action) => {
          const isOpen = action.id !== 'SOS' && props.openSheet === action.id;
          const isSos = action.id === 'SOS';
          return (
            <TouchableOpacity
              key={action.id}
              style={[
                styles.quickButton,
                isOpen && { borderColor: props.accentColor },
                isSos && styles.sosButton,
                isSos && !props.sosEnabled && styles.disabled,
              ]}
              onPress={() => props.onQuickAction(action.id)}
              disabled={isSos && !props.sosEnabled}
              activeOpacity={0.7}
            >
              <Text style={styles.quickText}>{action.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function OutcomeButton(props: {
  label: string;
  color: string;
  enabled: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[
        styles.primaryButton,
        { backgroundColor: props.color },
        !props.enabled && styles.disabled,
      ]}
      onPress={props.onPress}
      disabled={!props.enabled}
      activeOpacity={0.7}
    >
      <Text style={styles.outcomeText}>{props.label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: 'rgba(10, 14, 10, 0.94)',
    borderTopWidth: 1,
    borderTopColor: '#1F291F',
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 10,
    zIndex: MAP_SCREEN_LAYERS.bottomPanel,
    elevation: MAP_SCREEN_LAYERS.bottomPanel,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusText: {
    fontWeight: 'bold',
    fontSize: 13,
    marginRight: 6,
  },
  standText: {
    flex: 1,
    color: '#E8F5E9',
    fontSize: 13,
  },
  headingText: {
    fontWeight: 'bold',
    fontSize: 12,
    marginLeft: 6,
  },
  subText: {
    color: '#B0C4B0',
    fontSize: 11,
    marginTop: 2,
  },
  hintText: {
    color: '#FFB74D',
    fontSize: 12,
    marginTop: 2,
  },
  primaryRow: {
    flexDirection: 'row',
    marginTop: 8,
  },
  primaryButton: {
    flex: 1,
    minHeight: PRIMARY_BUTTON_MIN_HEIGHT,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 3,
    paddingHorizontal: 4,
  },
  primaryText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 18,
    textAlign: 'center',
  },
  outcomeText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 13,
    textAlign: 'center',
  },
  disabled: {
    opacity: 0.35,
  },
  cancelButton: {
    marginTop: 6,
    alignItems: 'center',
    paddingVertical: 8,
  },
  cancelText: {
    color: '#B0BEC5',
    textDecorationLine: 'underline',
    fontSize: 13,
  },
  quickRow: {
    flexDirection: 'row',
    marginTop: 8,
  },
  quickButton: {
    flex: 1,
    marginHorizontal: 3,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#37474F',
    backgroundColor: '#1A1F1A',
    alignItems: 'center',
  },
  sosButton: {
    backgroundColor: '#B71C1C',
    borderColor: '#FF5252',
  },
  quickText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 13,
  },
});
